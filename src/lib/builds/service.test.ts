import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BuildPlan } from "../build/types";
import { migrate, openDatabase } from "../db";
import { createFakeAdapter } from "./fake";
import { createBuildService } from "./service";
import { createBuildStore } from "./store";
import type { BuildAdapter, BuildRecord, RunUpdate } from "./types";

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
    resolved: [{ name: "luci", version: "1", source: "selected" }],
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
  it("records queued, polls to succeeded, and survives a restart", async () => {
    const db = database();
    const service = createBuildService({ store: createBuildStore(db), adapter: createFakeAdapter() });

    const submitted = await service.submit(plan());
    expect(submitted.status).toBe("queued");
    expect(submitted.runId).toBe("fake-run-1");

    expect((await service.refresh(submitted.id))?.status).toBe("queued");
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
    const service = createBuildService({ store: createBuildStore(db), adapter: failing });
    const record = await service.submit(plan());
    expect(record.status).toBe("failed");
    expect(record.error).toContain("401");
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
    expect(record?.status).toBe("queued");
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

  it("fails a queued record whose dispatch never recorded a run id", async () => {
    const db = database();
    const store = createBuildStore(db);
    const old = new Date(Date.now() - 10 * 60_000).toISOString();
    const record: BuildRecord = {
      id: "b-orphan",
      plan: plan(),
      status: "queued",
      runId: null,
      adapter: "fake",
      logTail: "",
      error: null,
      artifactName: null,
      createdAt: old,
      updatedAt: old,
    };
    store.create(record);

    const service = createBuildService({ store, adapter: createFakeAdapter() });
    const refreshed = await service.refresh("b-orphan");

    expect(refreshed?.status).toBe("failed");
    expect(refreshed?.error).toContain("matched");
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
