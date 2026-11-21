import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BuildPlan } from "../build/types";
import { migrate, openDatabase } from "../db";
import { ARTIFACT_SIZE_LIMIT_BYTES, ArtifactSizeLimitError } from "../image/postprocess";
import { createArtifactCache } from "./artifact-cache";
import { createArtifactCacheStore } from "./artifact-store";
import { createFakeAdapter } from "./fake";
import { createBuildService } from "./service";
import { createBuildStore } from "./store";
import type { BuildAdapter, RunUpdate } from "./types";

const dirs: string[] = [];

function databasePath() {
  const dir = mkdtempSync(join(tmpdir(), "cw-builds-"));
  dirs.push(dir);
  return join(dir, "builds.db");
}

function database() {
  const db = openDatabase(databasePath());
  migrate(db);
  return db;
}

function plan(): BuildPlan {
  return {
    baseVersion: "25.12.2",
    feedCommit: "abc",
    sourceNote: "fixture",
    profileId: "generic",
    profileTitle: "Generic x86/64",
    imageType: "ext4-efi",
    packages: ["luci"],
    resolved: [
      { name: "luci", version: "1", source: "selected", packageSource: "official", sourcePin: "", sha256: null, feed: "luci" },
    ],
    topLevelPackages: ["luci"],
    downloads: [],
    sourcePins: { official: {}, dllkids: null, supplement: null, kernel: null },
    missingDependencies: [],
    conflicts: [],
    files: [],
    artifactName: "immortalwrt-25.12.2-x86-64-generic-ext4-combined-efi.img.gz",
    imageBuilderCommand: "make image",
    createdAt: "2026-11-11T00:00:00.000Z",
  };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("build service", () => {
  it("cancels a running build and keeps it terminal", async () => {
    const db = database();
    const store = createBuildStore(db);
    const service = createBuildService({ store, adapter: createFakeAdapter() });
    const submitted = await service.submit(plan());
    expect(submitted.status).toBe("running");
    expect((await service.refresh(submitted.id))?.status).toBe("running");

    const cancelled = await service.cancel(submitted.id);
    expect(cancelled?.status).toBe("cancelled");
    expect((await service.refresh(submitted.id))?.status).toBe("cancelled");
    expect(store.listEvents(submitted.id).at(-1)?.source).toBe("cancel");
  });

  it("records the dispatched build, polls to succeeded, and survives a restart", async () => {
    const db = database();
    const service = createBuildService({ store: createBuildStore(db), adapter: createFakeAdapter() });

    const submitted = await service.submit(plan());
    expect(submitted.status).toBe("running");
    expect(submitted.runId).toBe("fake-run-1");

    // GitHub reports its own "queued" run state first; that must never hand a
    // dispatched build back to the site queue.
    expect((await service.refresh(submitted.id))?.status).toBe("running");
    expect((await service.refresh(submitted.id))?.status).toBe("running");
    const done = await service.refresh(submitted.id);
    expect(done?.status).toBe("succeeded");
    expect(done?.artifactName).toBe("build-fake-run-1.zip");
    expect(done?.logTail).toContain("image built");

    // Close and reopen the database file to prove the build survives a process restart.
    const path = (db.prepare("PRAGMA database_list").get() as { file: string }).file;
    db.close();
    const reopened = openDatabase(path);
    migrate(reopened);
    const restarted = createBuildService({ store: createBuildStore(reopened), adapter: createFakeAdapter() });
    expect(restarted.list()[0]?.id).toBe(submitted.id);
    expect((await restarted.refresh(submitted.id))?.status).toBe("succeeded");
    expect((await restarted.artifact(submitted.id))?.contentType).toBe("application/zip");
  });

  it("marks the build failed when dispatch throws", async () => {
    const failing: BuildAdapter = {
      name: "github",
      findRun: async () => null,
      dispatch: async () => {
        throw new Error("GitHub POST /dispatches failed: 401 bad credentials");
      },
      getRun: async () => ({ status: "queued" }),
      downloadArtifact: async () => {
        throw new Error("not implemented");
      },
    };
    const db = database();
    const store = createBuildStore(db);
    const service = createBuildService({ store, adapter: failing });
    const record = await service.submit(plan());
    expect(record.status).toBe("failed");
    expect(record.error).toContain("401");
    expect(record.failure?.step).toBe("dispatch");
    expect(store.listEvents(record.id).at(-1)?.source).toBe("dispatch");
  });

  it("keeps the previous status when a poll fails", async () => {
    const flaky: BuildAdapter = {
      name: "fake",
      findRun: async () => null,
      dispatch: async () => ({ runId: "r1" }),
      getRun: async () => {
        throw new Error("network down");
      },
      downloadArtifact: async () => {
        throw new Error("not implemented");
      },
    };
    const db = database();
    const service = createBuildService({ store: createBuildStore(db), adapter: flaky });
    const submitted = await service.submit(plan());
    const record = await service.refresh(submitted.id);
    expect(record?.status).toBe("running");
    expect(record?.error).toContain("network down");
  });
});

describe("build service resilience", () => {
  it("does not let a stale poll roll a terminal status back", async () => {
    const db = database();
    const store = createBuildStore(db);
    const service = createBuildService({ store, adapter: createFakeAdapter() });
    const submitted = await service.submit(plan());
    const before = store.get(submitted.id)!;

    store.update(submitted.id, { status: "succeeded", artifactName: "kept.zip" }, before.updatedAt);
    const stale = store.update(submitted.id, { status: "running" }, before.updatedAt);

    expect(stale.status).toBe("succeeded");
    expect(stale.artifactName).toBe("kept.zip");
  });

  it("marks a build failed after the build timeout", async () => {
    const db = database();
    const store = createBuildStore(db);
    const old = new Date(Date.now() - 61 * 60_000).toISOString();
    store.create({
      id: "b-timeout",
      plan: plan(),
      status: "running",
      runId: "r-timeout",
      adapter: "fake",
      logTail: "",
      error: null,
      artifactName: null,
      createdAt: old,
      updatedAt: old,
    });
    const service = createBuildService({ store, adapter: createFakeAdapter() });
    const refreshed = await service.refresh("b-timeout");
    expect(refreshed?.status).toBe("failed");
    expect(refreshed?.error).toContain("超时");
    expect(refreshed?.failure?.step).toBe("timeout");
    expect(store.listEvents("b-timeout").at(-1)?.source).toBe("timeout");
  });

  it("keeps polling a running build after a restart", async () => {
    const db = database();
    const store = createBuildStore(db);
    let status: "running" | "succeeded" = "running";
    const adapter: BuildAdapter = {
      name: "fake",
      findRun: async () => null,
      dispatch: async () => ({ runId: "r-restart" }),
      getRun: async () =>
        status === "running"
          ? { status: "running", logTail: "still building" }
          : { status: "succeeded", artifactName: "done.zip", logTail: "done" },
      downloadArtifact: async () => ({ name: "done.zip", contentType: "application/zip", body: new Uint8Array([1]) }),
    };
    const service = createBuildService({ store, adapter });
    const submitted = await service.submit(plan());
    expect((await service.refresh(submitted.id))?.status).toBe("running");

    const path = (db.prepare("PRAGMA database_list").get() as { file: string }).file;
    db.close();
    const reopened = openDatabase(path);
    migrate(reopened);

    status = "succeeded";
    const restarted = createBuildService({ store: createBuildStore(reopened), adapter });
    const finished = await restarted.refresh(submitted.id);
    expect(finished?.status).toBe("succeeded");
    expect(finished?.artifactName).toBe("done.zip");
  });
  it("re-enriches a terminal build that is missing its artifact", async () => {
    const db = database();
    const store = createBuildStore(db);
    const updates: RunUpdate[] = [{ status: "succeeded" }, { status: "succeeded", artifactName: "late.zip" }];
    const adapter: BuildAdapter = {
      name: "github",
      dispatch: async () => ({ runId: "r1" }),
      findRun: async () => "r1",
      getRun: async () => updates.shift() ?? { status: "succeeded" },
      downloadArtifact: async () => ({ name: "x", contentType: "application/zip", body: new Uint8Array() }),
    };
    const service = createBuildService({ store, adapter });

    const build = await service.submit(plan());
    expect((await service.refresh(build.id))?.artifactName).toBeNull();
    expect((await service.refresh(build.id))?.artifactName).toBe("late.zip");
  });

  it("does not let a stale poll overwrite a newer terminal state", async () => {
    const db = database();
    const store = createBuildStore(db);
    let release: (update: RunUpdate) => void = () => {};
    const gate = new Promise<RunUpdate>((resolve) => {
      release = resolve;
    });
    const adapter: BuildAdapter = {
      name: "github",
      dispatch: async () => ({ runId: "r1" }),
      findRun: async () => "r1",
      getRun: async () => gate,
      downloadArtifact: async () => ({ name: "x", contentType: "application/zip", body: new Uint8Array() }),
    };
    const service = createBuildService({ store, adapter });

    const build = await service.submit(plan());
    const pending = service.refresh(build.id);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Another poll (or process) finishes first.
    store.update(build.id, { status: "succeeded", artifactName: "new.zip", logTail: "ok" }, build.updatedAt);
    release({ status: "running" });

    const result = await pending;
    expect(result?.status).toBe("succeeded");
    expect(result?.artifactName).toBe("new.zip");
  });

});

describe("artifact cache integration", () => {
  function cacheDb() {
    const db = database();
    const dir = mkdtempSync(join(tmpdir(), "cw-artifacts-"));
    dirs.push(dir);
    return { db, dir, cache: createArtifactCache({ dir, store: createArtifactCacheStore(db) }) };
  }

  it("archives a download in the site cache and exposes it as a ranged file", async () => {
    const { db, dir, cache } = cacheDb();
    const service = createBuildService({
      store: createBuildStore(db),
      adapter: createFakeAdapter(),
      cacheDir: dir,
      cache,
    });
    const submitted = await service.submit(plan());
    await service.refresh(submitted.id);
    await service.refresh(submitted.id);
    expect((await service.refresh(submitted.id))?.status).toBe("succeeded");

    const file = await service.artifactFile(submitted.id);
    expect(file?.size).toBe(20);
    expect(file?.kind).toBe("combined");
    expect(file?.path.startsWith(dir)).toBe(true);
    // Ticket 13: the cached bytes are the ZIP container, and the file info says so.
    expect(file?.contentType).toBe("application/zip");
    const imageName = service.get(submitted.id)?.artifactName as string;
    expect(file?.containerName).toBe(/[.]zip$/i.test(imageName) ? imageName : `${imageName}.zip`);
    expect(file?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(file?.imageSha256 ?? null).toBeNull();
    expect(file?.imageSize ?? null).toBeNull();
    // The container facts are written back so the page can show them before download.
    const saved = service.get(submitted.id);
    expect(saved?.artifactContainerSha256).toBe(file?.sha256);
    expect(saved?.artifactContainerSize).toBe(20);
    // The second call is served from the index, not by downloading again.
    expect((await service.artifactFile(submitted.id))?.path).toBe(file?.path);

    const download = await service.artifact(submitted.id);
    expect(download?.contentType).toBe("application/zip");
  });

  it("keeps a V1 legacy <id>.zip cache file downloadable", async () => {
    const { db, dir, cache } = cacheDb();
    const service = createBuildService({
      store: createBuildStore(db),
      adapter: createFakeAdapter(),
      cacheDir: dir,
      cache,
    });
    const submitted = await service.submit(plan());
    await service.refresh(submitted.id);
    await service.refresh(submitted.id);
    await service.refresh(submitted.id);

    // Simulate the pre-ticket-14 cache layout, written before this build ran.
    writeFileSync(join(dir, `${submitted.id}.zip`), "legacy-zip");

    const restarted = createBuildService({
      store: createBuildStore(db),
      adapter: createFakeAdapter(),
      cacheDir: dir,
      cache: createArtifactCache({ dir, store: createArtifactCacheStore(db) }),
    });
    const file = await restarted.artifactFile(submitted.id);
    expect(file?.path).toBe(join(dir, `${submitted.id}.zip`));
    expect(file?.size).toBe("legacy-zip".length);
    // A legacy flat cache file has no indexed digest; it is hashed once and remembered.
    expect(file?.sha256).toBe(createHash("sha256").update("legacy-zip").digest("hex"));
    expect(restarted.get(submitted.id)?.artifactContainerSha256).toBe(file?.sha256);
  });

  it("rejects an over-cap artifact before caching it", async () => {
    const { db, dir, cache } = cacheDb();
    const oversized: BuildAdapter = {
      name: "fake",
      findRun: async () => null,
      dispatch: async () => ({ runId: "run-big" }),
      getRun: async () => ({ status: "succeeded", artifactName: "big.img.gz", logTail: "ok" }),
      downloadArtifact: async () => ({
        name: "big.img.gz",
        contentType: "application/gzip",
        size: ARTIFACT_SIZE_LIMIT_BYTES + 1,
        body: new Uint8Array([1]),
      }),
    };
    const service = createBuildService({
      store: createBuildStore(db),
      adapter: oversized,
      cacheDir: dir,
      cache,
    });
    const submitted = await service.submit(plan());
    await service.refresh(submitted.id);

    await expect(service.artifactFile(submitted.id)).rejects.toBeInstanceOf(ArtifactSizeLimitError);
    expect(cache.stats().entries).toBe(0);
    expect(existsSync(join(dir, submitted.id))).toBe(false);
  });
});
