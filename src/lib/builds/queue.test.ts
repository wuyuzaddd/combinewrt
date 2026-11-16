import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BuildPlan } from "../build/types";
import { EMPTY_SOURCE_PINS } from "../catalog/types";
import { migrate, openDatabase } from "../db";
import type { BuildPlanV2 } from "../domain/build-plan";
import type { ImageVariant } from "../domain/types";
import { createBuildService } from "./service";
import { createBuildStore } from "./store";
import type { BuildAdapter, RunUpdate } from "./types";

const dirs: string[] = [];

function databasePath() {
  const dir = mkdtempSync(join(tmpdir(), "cw-queue-"));
  dirs.push(dir);
  return join(dir, "builds.db");
}

function database() {
  const db = openDatabase(databasePath());
  migrate(db);
  return db;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function plan(): BuildPlan {
  return {
    baseVersion: "25.12.2",
    feedCommit: "abc",
    sourceNote: "fixture",
    profileId: "generic",
    profileTitle: "Generic x86/64",
    imageType: "ext4-efi",
    packages: ["luci"],
    resolved: [],
    topLevelPackages: ["luci"],
    downloads: [],
    sourcePins: EMPTY_SOURCE_PINS,
    missingDependencies: [],
    conflicts: [],
    files: [],
    artifactName: "immortalwrt-25.12.2-x86-64-generic-ext4-combined-efi.img.gz",
    imageBuilderCommand: "make image",
    createdAt: "2026-11-11T00:00:00.000Z",
  };
}

function sourcePlan(variant: ImageVariant = { boot: "efi", filesystem: "ext4", artifact: "combined" }): BuildPlanV2 {
  return {
    ...plan(),
    schemaVersion: 2,
    channel: "release",
    target: { id: "x86/64", architecture: "x86_64", subtarget: "64", title: "x86/64" },
    deviceProfile: { targetId: "x86/64", id: "generic", title: "Generic x86/64", capabilities: [] },
    kernelLine: { id: "6.6", version: "6.6", engine: "source" },
    imageVariant: variant,
    basePreset: { id: "minimal", layer: "file/board" },
    overlays: [],
    engine: "source",
    artifactName: "immortalwrt-24.10-SNAPSHOT-x86-64-generic-ext4-combined-efi.img.gz",
  } as BuildPlanV2;
}

interface HarnessOptions {
  failOnCall?: number;
}

function harness(options: HarnessOptions = {}) {
  const dispatched: string[] = [];
  const cancelled: string[] = [];
  const updates = new Map<string, RunUpdate>();
  const runFor = (buildId: string) => `run-${buildId}`;
  let calls = 0;

  const adapter: BuildAdapter = {
    name: "fake",
    async findRun() {
      return null;
    },
    async dispatch(_plan, meta) {
      calls += 1;
      if (options.failOnCall === calls) {
        throw new Error("GitHub POST /dispatches failed: 500 boom");
      }
      dispatched.push(meta.buildId);
      const runId = runFor(meta.buildId);
      updates.set(runId, { status: "running", logTail: "" });
      return { runId };
    },
    async getRun(runId: string) {
      return updates.get(runId) ?? { status: "running", logTail: "" };
    },
    async cancelRun(runId: string) {
      cancelled.push(runId);
      updates.set(runId, { status: "cancelled" });
    },
    async downloadArtifact() {
      throw new Error("not implemented");
    },
  };

  return { adapter, dispatched, cancelled, updates, runFor };
}

describe("build queue", () => {
  it("dispatches FIFO up to the concurrency cap and leaves the rest queued", async () => {
    const h = harness();
    const store = createBuildStore(database());
    const service = createBuildService({ store, adapter: h.adapter, maxConcurrentBuilds: 2 });

    const first = await service.submit(plan());
    const second = await service.submit(plan());
    const third = await service.submit(plan());

    expect(h.dispatched).toEqual([first.id, second.id]);
    expect(first.status).toBe("running");
    expect(first.runId).toBe(h.runFor(first.id));
    expect(first.dispatchedAt).toBeTruthy();
    expect(second.status).toBe("running");
    expect(third.status).toBe("queued");
    expect(third.runId).toBeNull();
    expect(third.dispatchedAt).toBeNull();
  });

  it("dispatches the next queued build when a running build finishes", async () => {
    const h = harness();
    const store = createBuildStore(database());
    const service = createBuildService({ store, adapter: h.adapter, maxConcurrentBuilds: 2 });

    const first = await service.submit(plan());
    const second = await service.submit(plan());
    const third = await service.submit(plan());
    expect(third.status).toBe("queued");

    h.updates.set(first.runId as string, { status: "succeeded", artifactName: "first.zip", logTail: "done" });
    const finished = await service.refresh(first.id);

    expect(finished?.status).toBe("succeeded");
    expect(h.dispatched).toEqual([first.id, second.id, third.id]);
    const started = service.get(third.id)!;
    expect(started.status).toBe("running");
    expect(started.runId).toBe(h.runFor(third.id));
  });

  it("honours a configured cap of one build", async () => {
    const h = harness();
    const store = createBuildStore(database());
    const service = createBuildService({ store, adapter: h.adapter, maxConcurrentBuilds: 1 });

    const first = await service.submit(plan());
    const second = await service.submit(plan());

    expect(h.dispatched).toEqual([first.id]);
    expect(second.status).toBe("queued");
  });

  it("records a structured dispatch failure and never leaves a phantom run", async () => {
    const h = harness({ failOnCall: 2 });
    const store = createBuildStore(database());
    const service = createBuildService({ store, adapter: h.adapter, maxConcurrentBuilds: 2 });

    const first = await service.submit(plan());
    const broken = await service.submit(plan());

    expect(broken.status).toBe("failed");
    expect(broken.error).toContain("500 boom");
    expect(broken.failure?.step).toBe("dispatch");
    expect(broken.runId).toBeNull();
    expect(store.listEvents(broken.id).at(-1)?.source).toBe("dispatch");

    // The failed dispatch freed its slot: the next submission starts immediately.
    const next = await service.submit(plan());
    expect(h.dispatched).toEqual([first.id, next.id]);
    expect(next.status).toBe("running");
  });

  it("never dispatches the same build twice", async () => {
    const h = harness();
    const store = createBuildStore(database());
    const service = createBuildService({ store, adapter: h.adapter, maxConcurrentBuilds: 2 });

    const build = await service.submit(plan());
    await service.pump();
    await service.pump();
    await service.refresh(build.id);

    expect(h.dispatched.filter((id) => id === build.id)).toHaveLength(1);
  });

  it("keeps a dispatched build running when GitHub still reports it queued", async () => {
    const h = harness();
    const store = createBuildStore(database());
    const service = createBuildService({ store, adapter: h.adapter, maxConcurrentBuilds: 2 });

    const build = await service.submit(plan());
    h.updates.set(build.runId as string, { status: "queued" });

    const polled = await service.refresh(build.id);
    expect(polled?.status).toBe("running");

    // A queued sighting must never hand the build back to the queue.
    await service.pump();
    expect(h.dispatched).toEqual([build.id]);
  });
});

describe("build queue cancellation", () => {
  it("cancels a queued build without calling GitHub", async () => {
    const h = harness();
    const store = createBuildStore(database());
    const service = createBuildService({ store, adapter: h.adapter, maxConcurrentBuilds: 2 });

    const first = await service.submit(plan());
    const second = await service.submit(plan());
    const waiting = await service.submit(plan());
    expect(waiting.status).toBe("queued");

    const cancelled = await service.cancel(waiting.id);

    expect(cancelled?.status).toBe("cancelled");
    expect(h.dispatched).toEqual([first.id, second.id]);
    expect(h.cancelled).toEqual([]);
    expect(store.listEvents(waiting.id).at(-1)?.source).toBe("cancel");

    // A later pump must not resurrect a cancelled build.
    await service.pump();
    expect(h.dispatched).not.toContain(waiting.id);
    expect(service.get(waiting.id)?.status).toBe("cancelled");
  });

  it("cancels a running build through the GitHub cancel API and starts the next one", async () => {
    const h = harness();
    const store = createBuildStore(database());
    const service = createBuildService({ store, adapter: h.adapter, maxConcurrentBuilds: 2 });

    const first = await service.submit(plan());
    const second = await service.submit(plan());
    const waiting = await service.submit(plan());

    const cancelled = await service.cancel(first.id);
    // Cancelling frees the slot in the background; let the queue take the next build.
    await service.pump();

    expect(cancelled?.status).toBe("cancelled");
    expect(h.cancelled).toEqual([first.runId]);
    expect(store.listEvents(first.id).at(-1)?.source).toBe("cancel");
    // The freed slot is filled by the oldest queued build.
    expect(h.dispatched).toEqual([first.id, second.id, waiting.id]);
    expect(service.get(waiting.id)?.status).toBe("running");
  });

  it("cancels a build while its dispatch is in flight and cancels the late run", async () => {
    const db = database();
    const store = createBuildStore(db);
    const cancelledRuns: string[] = [];
    let release: (value: { runId: string | null }) => void = () => {};
    const gate = new Promise<{ runId: string | null }>((resolve) => {
      release = resolve;
    });
    const adapter: BuildAdapter = {
      name: "fake",
      findRun: async () => null,
      dispatch: async () => gate,
      getRun: async () => ({ status: "running" }),
      cancelRun: async (runId: string) => {
        cancelledRuns.push(runId);
      },
      downloadArtifact: async () => {
        throw new Error("not implemented");
      },
    };
    const service = createBuildService({ store, adapter, maxConcurrentBuilds: 2 });

    const pending = service.submit(plan());
    await new Promise((resolve) => setTimeout(resolve, 0));
    const [record] = store.list();
    expect(record?.status).toBe("running");
    expect(record?.runId).toBeNull();

    const cancelled = await service.cancel(record!.id);
    expect(cancelled?.status).toBe("cancelled");

    // The dispatch resolves after the cancel; the late run must be cancelled on
    // GitHub and recorded, not left running behind a cancelled build.
    release({ runId: "late-run" });
    await pending;
    await service.pump();

    expect(cancelledRuns).toEqual(["late-run"]);
    const final = service.get(record!.id)!;
    expect(final.status).toBe("cancelled");
    expect(final.runId).toBe("late-run");
  });
});

describe("build queue restart recovery", () => {
  it("resumes running builds and dispatches queued builds after a restart", async () => {
    const path = databasePath();
    const first = openDatabase(path);
    migrate(first);
    const h = harness();
    const store = createBuildStore(first);
    const service = createBuildService({ store, adapter: h.adapter, maxConcurrentBuilds: 2 });

    const a = await service.submit(plan());
    const b = await service.submit(plan());
    const c = await service.submit(plan());
    expect(c.status).toBe("queued");
    first.close();

    const reopened = openDatabase(path);
    migrate(reopened);
    const h2 = harness();
    const restartedStore = createBuildStore(reopened);
    const restarted = createBuildService({ store: restartedStore, adapter: h2.adapter, maxConcurrentBuilds: 2 });

    // Nothing is re-dispatched, and the recorded run ids survive the restart.
    expect(restartedStore.get(a.id)?.runId).toBe(a.runId);
    await restarted.pump();
    expect(h2.dispatched).toEqual([]);
    expect(restartedStore.get(c.id)?.status).toBe("queued");

    // The running build keeps being polled, not restarted.
    expect((await restarted.refresh(b.id))?.status).toBe("running");
    expect(h2.dispatched).toEqual([]);

    // Finishing one build lets the queued one start.
    restartedStore.update(a.id, { status: "succeeded" });
    await restarted.pump();
    expect(h2.dispatched).toEqual([c.id]);
    expect(restartedStore.get(c.id)?.status).toBe("running");
  });

  it("fails a running build that never recorded a run id instead of re-dispatching it", async () => {
    const db = database();
    const store = createBuildStore(db);
    const old = new Date(Date.now() - 10 * 60_000).toISOString();
    store.create({
      id: "orphan",
      plan: plan(),
      status: "running",
      runId: null,
      engine: "imagebuilder",
      target: null,
      dispatchedAt: old,
      adapter: "fake",
      logTail: "",
      error: null,
      artifactName: null,
      createdAt: old,
      updatedAt: old,
    });

    const h = harness();
    const service = createBuildService({ store, adapter: h.adapter, maxConcurrentBuilds: 2 });
    const refreshed = await service.refresh("orphan");

    expect(refreshed?.status).toBe("failed");
    expect(refreshed?.error).toContain("matched");
    expect(refreshed?.failure?.step).toBe("dispatch");
    expect(h.dispatched).toEqual([]);
  });

  it("does not time out a build while it is still queued", async () => {
    const db = database();
    const store = createBuildStore(db);
    const old = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
    store.create({
      id: "waiting",
      plan: plan(),
      status: "queued",
      runId: null,
      engine: "imagebuilder",
      target: null,
      dispatchedAt: null,
      adapter: "fake",
      logTail: "",
      error: null,
      artifactName: null,
      createdAt: old,
      updatedAt: old,
    });

    const h = harness();
    const service = createBuildService({ store, adapter: h.adapter, maxConcurrentBuilds: 2 });
    const refreshed = await service.refresh("waiting");
    expect(refreshed?.status).toBe("queued");

    await service.pump();
    expect(service.get("waiting")?.status).toBe("running");
    expect(h.dispatched).toEqual(["waiting"]);
  });
});

describe("build queue metadata", () => {
  it("records the engine and target the plan selected", async () => {
    const h = harness();
    const store = createBuildStore(database());
    const service = createBuildService({ store, adapter: h.adapter, maxConcurrentBuilds: 2 });

    const v1 = await service.submit(plan());
    expect(v1.engine).toBe("imagebuilder");
    expect(v1.target).toBeNull();

    const v2 = await service.submit(sourcePlan());
    expect(v2.engine).toBe("source");
    expect(v2.target).toBe("x86/64");
    expect(v2.status).toBe("running");
  });
});
