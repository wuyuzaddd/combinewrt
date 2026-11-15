import { strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import { createGitHubAdapter, dispatchRepositoryEvent, listWorkflowRuns, mapRunState, parseFailure, parseManifest } from "./github";
import type { BuildPlan } from "../build/types";

const plan = {
  profileId: "generic",
  imageType: "ext4-efi",
} as BuildPlan;

function response(body: unknown, status = 200) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

describe("github adapter", () => {
  it("maps run states to build statuses", () => {
    expect(mapRunState({ id: 1, name: "", status: "queued", conclusion: null, created_at: "" }).status).toBe("queued");
    expect(mapRunState({ id: 1, name: "", status: "in_progress", conclusion: null, created_at: "" }).status).toBe("running");
    expect(mapRunState({ id: 1, name: "", status: "completed", conclusion: "success", created_at: "" }).status).toBe("succeeded");
    expect(mapRunState({ id: 1, name: "", status: "completed", conclusion: "failure", created_at: "" })).toEqual({
      status: "failed",
      error: "workflow concluded with failure",
    });
    expect(mapRunState({ id: 1, name: "", status: "completed", conclusion: "cancelled", created_at: "" }).status).toBe(
      "cancelled",
    );
  });

  it("cancels a run through the GitHub API", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(null, { status: 202 }));
    const adapter = createGitHubAdapter({
      repo: "me/build",
      token: "token",
      workflow: "build.yml",
      fetchImpl,
    });
    await adapter.cancelRun!("42");
    const [url, init] = fetchImpl.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/me/build/actions/runs/42/cancel");
    expect(init.method).toBe("POST");
  });

  it("dispatches a repository event with a small payload", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 }));
    await dispatchRepositoryEvent({
      repo: "me/build",
      token: "t",
      eventType: "supplement-build",
      clientPayload: { base_version: "25.12.3" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const [url, init] = fetchImpl.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/me/build/dispatches");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      event_type: "supplement-build",
      client_payload: { base_version: "25.12.3" },
    });
  });

  it("dispatches the workflow and finds the newest run", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response(undefined, 204))
      .mockResolvedValueOnce(
        response({
          workflow_runs: [
            {
              id: 42,
              name: "CI",
              display_title: "combinewrt-b1",
              status: "queued",
              conclusion: null,
              created_at: new Date().toISOString(),
            },
          ],
        }),
      );

    const adapter = createGitHubAdapter({
      repo: "me/build",
      token: "t",
      workflow: "build.yml",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
    });

    const result = await adapter.dispatch(plan, { buildId: "b1", artifactName: "image.gz" });
    expect(result.runId).toBe("42");

    const [, secondCall] = fetchImpl.mock.calls;
    expect(String(secondCall[0])).toContain("/actions/workflows/build.yml/runs");
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1].body));
    expect(body.event_type).toBe("combinewrt-build");
    const payload = body.client_payload;
    expect(payload.buildId).toBe("b1");
    expect(payload.artifactName).toBe("image.gz");
    expect(payload.profileId).toBe("generic");
    expect(payload.composition.topLevelPackages).toEqual(plan.topLevelPackages);
    expect(payload.composition.downloads).toEqual(plan.downloads);
  });

  it("ships the resolved modes inside the composition for V2 plans", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response(undefined, 204))
      .mockResolvedValueOnce(
        response({
          workflow_runs: [
            {
              id: 43,
              name: "CI",
              display_title: "combinewrt-b2",
              status: "queued",
              conclusion: null,
              created_at: new Date().toISOString(),
            },
          ],
        }),
      );
    const adapter = createGitHubAdapter({
      repo: "me/build",
      token: "t",
      workflow: "build.yml",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
    });
    const modes = {
      basePreset: { id: "minimal", layer: "file/board", title: "Minimal", experimental: false },
      overlays: [],
      experimental: [],
      secrets: [],
      generatedFiles: [],
      network: { wan: { protocol: "dhcp", device: "default" } },
    };
    const v2plan = {
      ...plan,
      schemaVersion: 2,
      baseVersion: "25.12.2",
      feedCommit: "0".repeat(40),
      packages: ["luci"],
      topLevelPackages: ["luci"],
      sourcePins: {},
      downloads: [],
      files: [],
      imageBuilderCommand: "make -j$(nproc) image PROFILE=generic PACKAGES=\"luci\" FILES=files",
      target: { id: "x86/64", architecture: "x86_64", subtarget: "64", title: "x86/64" },
      kernelLine: { id: "linux-6.6", version: "6.6", engine: "imagebuilder" },
      imageVariant: { boot: "efi", filesystem: "ext4", artifact: "combined" },
      basePreset: { id: "minimal", layer: "file/board" },
      overlays: [],
      engine: "imagebuilder",
      modes,
    } as unknown as BuildPlan;

    await adapter.dispatch(v2plan, { buildId: "b2", artifactName: "image.gz" });

    const body = JSON.parse(String(fetchImpl.mock.calls[0][1].body));
    expect(body.client_payload.composition.modes.basePreset.id).toBe("minimal");
    expect(Object.keys(body.client_payload)).toHaveLength(10);
    expect(body.client_payload.composition.v2.imageVariant).toEqual({
      boot: "efi",
      filesystem: "ext4",
      artifact: "combined",
    });
  });

  it("parses the manifest marker emitted by the workflow", () => {
    const log = `make image\nCOMBINEWRT_MANIFEST=${JSON.stringify({ artifactName: "a.img.gz", sha256: "a".repeat(64), size: 123 })}\n`;
    const manifest = parseManifest(log);
    expect(manifest?.size).toBe(123);
    expect(manifest?.sha256).toHaveLength(64);
    expect(parseManifest("no marker")).toBeNull();
    expect(parseManifest("COMBINEWRT_MANIFEST={\"sha256\":\"bad\",\"size\":1}")).toBeNull();
  });

  it("parses the V2 manifest with target, variant and both artifact digests", () => {
    const manifest = {
      schemaVersion: 2,
      artifactName: "immortalwrt-25.12.2-x86-64-generic-ext4-combined-efi.qcow2",
      path: "/work/bin/targets/x86/64/immortalwrt-25.12.2-x86-64-generic-ext4-combined-efi.qcow2",
      sha256: "b".repeat(64),
      size: 4096,
      target: { id: "x86/64", architecture: "x86_64", subtarget: "64" },
      kernelLine: { id: "linux-6.6", version: "6.6", engine: "imagebuilder" },
      variant: { boot: "efi", filesystem: "ext4", artifact: "qcow2", overlaySizeMb: 512 },
      engine: "imagebuilder",
      raw: { name: "immortalwrt-25.12.2-x86-64-generic-ext4-combined-efi.img", sha256: "a".repeat(64), size: 8192 },
      converted: { name: "immortalwrt-25.12.2-x86-64-generic-ext4-combined-efi.qcow2", sha256: "b".repeat(64), size: 4096 },
    };
    const parsed = parseManifest(`build log\nCOMBINEWRT_MANIFEST=${JSON.stringify(manifest)}\n`);
    expect(parsed?.schemaVersion).toBe(2);
    expect(parsed?.target).toEqual(manifest.target);
    expect(parsed?.variant).toEqual(manifest.variant);
    expect(parsed?.raw?.sha256).toBe("a".repeat(64));
    expect(parsed?.converted?.size).toBe(4096);
  });

  it("reads logs and artifacts for a completed run", async () => {
    const logs = zipSync({ "build.txt": strToU8("step one\nstep two\n") });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          id: 42,
          name: "CI",
          display_title: "combinewrt-b1",
          status: "completed",
          conclusion: "success",
          created_at: new Date().toISOString(),
        }),
      )
      .mockResolvedValueOnce(new Response(logs as unknown as BodyInit, { status: 200 }))
      .mockResolvedValueOnce(response({ artifacts: [{ name: "build-b1" }] }));

    const adapter = createGitHubAdapter({
      repo: "me/build",
      token: "t",
      workflow: "build.yml",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const update = await adapter.getRun("42");
    expect(update.status).toBe("succeeded");
    expect(update.logTail).toContain("step two");
    expect(update.artifactName).toBe("build-b1");
  });

  it("summarizes the failure from the log tail", async () => {
    const logs = zipSync({ "build.txt": strToU8("ok\n##[error]boom: missing dependency\n") });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          id: 42,
          name: "CI",
          display_title: "combinewrt-b1",
          status: "completed",
          conclusion: "failure",
          created_at: new Date().toISOString(),
        }),
      )
      .mockResolvedValueOnce(new Response(logs as unknown as BodyInit, { status: 200 }))
      .mockResolvedValueOnce(response({ artifacts: [] }));

    const adapter = createGitHubAdapter({
      repo: "me/build",
      token: "t",
      workflow: "build.yml",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const update = await adapter.getRun("42");
    expect(update.status).toBe("failed");
    expect(update.error).toContain("missing dependency");
    expect(update.artifactName).toBeNull();
  });

  it("returns the artifact from the run", async () => {
    const body = new Uint8Array([1, 2, 3]);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response({ artifacts: [{ name: "build-b1", archive_download_url: "https://dl" }] }))
      .mockResolvedValueOnce(new Response(body, { status: 200 }));

    const adapter = createGitHubAdapter({
      repo: "me/build",
      token: "t",
      workflow: "build.yml",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const artifact = await adapter.downloadArtifact("42", "build-b1");
    expect(artifact.name).toBe("build-b1.zip");
    const streamed = new Uint8Array(await new Response(artifact.body as BodyInit).arrayBuffer());
    expect(streamed).toEqual(body);
  });
  it("picks the artifact the site asked for", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          id: 7,
          name: "CI",
          status: "completed",
          conclusion: "success",
          created_at: "2026-11-11T00:00:00Z",
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(response({ artifacts: [{ name: "debug-log" }, { name: "image.gz" }] }));

    const adapter = createGitHubAdapter({
      repo: "me/build",
      token: "t",
      workflow: "build.yml",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const update = await adapter.getRun("7", "image.gz");
    expect(update.artifactName).toBe("image.gz");
  });

});

describe("listWorkflowRuns", () => {
  it("lists recent runs with workflow, state and URL", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      response({
        workflow_runs: [
          {
            id: 42,
            name: "packages",
            display_title: "packages 25.12.2",
            status: "completed",
            conclusion: "success",
            created_at: "2026-11-15T04:00:00Z",
            html_url: "https://github.com/me/build/actions/runs/42",
          },
        ],
      }),
    );

    const runs = await listWorkflowRuns({
      repo: "me/build",
      token: "t",
      workflow: "packages.yml",
      limit: 3,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(runs).toEqual([
      {
        id: "42",
        workflow: "packages.yml",
        status: "completed",
        conclusion: "success",
        title: "packages 25.12.2",
        createdAt: "2026-11-15T04:00:00Z",
        url: "https://github.com/me/build/actions/runs/42",
      },
    ]);
    const [url, init] = fetchImpl.mock.calls[0]! as [string, RequestInit];
    expect(url).toContain("/actions/workflows/packages.yml/runs?per_page=3");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer t");
  });

  it("surfaces GitHub errors without leaking the token", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response("nope", { status: 403 }));
    await expect(
      listWorkflowRuns({ repo: "me/build", token: "secret", workflow: "build.yml", fetchImpl }),
    ).rejects.toThrow(/403 nope/);
  });
});

describe("parseFailure", () => {
  it("parses the structured failure marker with source details", () => {
    const log = [
      "step output",
      'COMBINEWRT_FAILURE={"step":"download-packages","package":"lucky","source":"dllkids","version":"3.5.0-r1","message":"hash mismatch"}',
    ].join("\n");
    expect(parseFailure(log)).toEqual({
      step: "download-packages",
      package: "lucky",
      source: "dllkids",
      version: "3.5.0-r1",
      message: "hash mismatch",
    });
  });

  it("falls back to the legacy missing-package marker", () => {
    expect(parseFailure("ok\nCOMBINEWRT_FAILED_PACKAGE=luci-app-lucky\n")).toEqual({
      step: "assert-packages",
      package: "luci-app-lucky",
      source: null,
      version: null,
      message: "package luci-app-lucky is missing from the generated image",
    });
  });

  it("returns null without a marker", () => {
    expect(parseFailure("plain failure")).toBeNull();
  });

  it("keeps the V2 target/variant context from the marker", () => {
    const log = [
      "step output",
      'COMBINEWRT_FAILURE={"step":"postprocess","package":null,"source":null,"version":null,"message":"qemu-img convert failed","context":{"target":"x86/64","variant":"efi-ext4-qcow2","engine":"imagebuilder"}}',
    ].join("\n");
    expect(parseFailure(log)).toEqual({
      step: "postprocess",
      package: null,
      source: null,
      version: null,
      message: "qemu-img convert failed",
      context: { target: "x86/64", variant: "efi-ext4-qcow2", engine: "imagebuilder" },
    });
  });

  it("drops an unknown failure context but keeps the failure", () => {
    const log =
      'COMBINEWRT_FAILURE={"step":"build-image","message":"make failed","context":{"target":"x86/64","engine":"watchtower"}}';
    const failure = parseFailure(log);
    expect(failure?.step).toBe("build-image");
    expect(failure?.context).toEqual({ target: "x86/64" });
  });
});
