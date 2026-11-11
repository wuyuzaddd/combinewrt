import { strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import { createGitHubAdapter, mapRunState, parseManifest } from "./github";
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
  });

  it("parses the manifest marker emitted by the workflow", () => {
    const log = `make image\nCOMBINEWRT_MANIFEST=${JSON.stringify({ artifactName: "a.img.gz", sha256: "a".repeat(64), size: 123 })}\n`;
    const manifest = parseManifest(log);
    expect(manifest?.size).toBe(123);
    expect(manifest?.sha256).toHaveLength(64);
    expect(parseManifest("no marker")).toBeNull();
    expect(parseManifest("COMBINEWRT_MANIFEST={\"sha256\":\"bad\",\"size\":1}")).toBeNull();
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
