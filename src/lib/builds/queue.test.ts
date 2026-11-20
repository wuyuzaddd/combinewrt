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
import { createBuildStore, type BuildStore } from "./store";
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
    const secret = "r".repeat(48);
    const service = createBuildService({
      store,
      adapter: h.adapter,
      maxConcurrentBuilds: 2,
      sessionSecret: secret,
    });

    const a = await service.submit(plan());
    const b = await service.submit(plan());
    const c = await service.submit(plan());
    expect(c.status).toBe("queued");
    first.close();

    const reopened = openDatabase(path);
    migrate(reopened);
    const h2 = harness();
    const restartedStore = createBuildStore(reopened);
    const restarted = createBuildService({
      store: restartedStore,
      adapter: h2.adapter,
      maxConcurrentBuilds: 2,
      sessionSecret: secret,
    });

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

describe("plan secrets at dispatch time", () => {
  it("dispatches the full plan once, without persisting its secrets", async () => {
    const db = database();
    const store = createBuildStore(db);
    const seen: BuildPlan[] = [];
    const adapter: BuildAdapter = {
      name: "fake",
      async findRun() {
        return null;
      },
      async dispatch(plan) {
        seen.push(plan);
        return { runId: "run-1" };
      },
      async getRun() {
        return { status: "running", logTail: "" };
      },
      async downloadArtifact() {
        throw new Error("not implemented");
      },
    };
    const service = createBuildService({ store, adapter, maxConcurrentBuilds: 2 });
    const plan = {
      ...sourcePlan(),
      files: [{ path: "files/etc/uci-defaults/99-combinewrt", content: "root_password='$5$secret'", mode: 0o755 }],
    } as BuildPlan;

    await service.submit(plan);

    // The workflow must receive the real overlay content ...
    expect(seen).toHaveLength(1);
    expect(seen[0]?.files[0]?.content).toBe("root_password='$5$secret'");
    // ... while the stored row does not keep it.
    const raw = db.prepare("SELECT plan_json FROM builds").get() as { plan_json: string };
    expect(raw.plan_json).not.toContain("$5$secret");
  });

  it("fails a redacted plan restored after a restart instead of building without its overlay", async () => {
    const db = database();
    const store = createBuildStore(db);
    const timestamp = "2026-11-11T00:00:00.000Z";
    store.create({
      id: "restored",
      plan: {
        ...sourcePlan(),
        files: [{ path: "files/etc/uci-defaults/99-combinewrt", content: "#!/bin/sh\nexit 0\n", mode: 0o755 }],
      } as BuildPlan,
      config: null,
      status: "queued",
      runId: null,
      adapter: "fake",
      logTail: "",
      error: null,
      artifactName: "image.tar.gz",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    let dispatched = 0;
    const adapter: BuildAdapter = {
      name: "fake",
      async findRun() {
        return null;
      },
      async dispatch() {
        dispatched += 1;
        return { runId: "run-restored" };
      },
      async getRun() {
        return { status: "running", logTail: "" };
      },
      async downloadArtifact() {
        throw new Error("not implemented");
      },
    };

    const service = createBuildService({ store, adapter, maxConcurrentBuilds: 2 });
    await service.pump();

    expect(dispatched).toBe(0);
    const record = store.get("restored");
    expect(record?.status).toBe("failed");
    expect(record?.failure?.step).toBe("dispatch");
    expect(record?.error).toMatch(/重新提交|resubmit/);
  });
});

describe("encrypted dispatch payload across the queue", () => {
  const SECRET = "s".repeat(48);
  const OTHER_SECRET = "t".repeat(48);

  function planWithSecret(secret: string): BuildPlan {
    return {
      ...plan(),
      files: [
        {
          path: "files/etc/uci-defaults/99-combinewrt",
          mode: 0o755,
          content: `root_password='${secret}'\n`,
        },
      ],
    } as BuildPlan;
  }

  function recordingAdapter(seen: BuildPlan[]) {
    let calls = 0;
    const adapter: BuildAdapter = {
      name: "fake",
      async findRun() {
        return null;
      },
      async dispatch(plan, meta) {
        calls += 1;
        seen.push(plan);
        return { runId: `run-${meta.buildId}` };
      },
      async getRun() {
        return { status: "running", logTail: "" };
      },
      async downloadArtifact() {
        throw new Error("not implemented");
      },
    };
    return { adapter, calls: () => calls };
  }

  it("dispatches a build queued by the cap after the slot frees (same process)", async () => {
    const db = database();
    const store = createBuildStore(db);
    const seen: BuildPlan[] = [];
    const recorder = recordingAdapter(seen);
    const service = createBuildService({
      store,
      adapter: recorder.adapter,
      maxConcurrentBuilds: 1,
      sessionSecret: SECRET,
    });

    const first = await service.submit(planWithSecret("first"));
    const waiting = await service.submit(planWithSecret("second"));
    expect(waiting.status).toBe("queued");
    expect(recorder.calls()).toBe(1);

    store.update(first.id, { status: "succeeded" });
    await service.pump();

    expect(recorder.calls()).toBe(2);
    // The dispatcher opened the sealed payload: the generated file content is
    // the one submitted with the queued build, not a redacted placeholder.
    expect(seen[1]?.files[0]?.content).toBe("root_password='second'\n");
    expect(service.get(waiting.id)?.status).toBe("running");
    expect(service.get(waiting.id)?.runId).toBe(`run-${waiting.id}`);
  });

  it("dispatches a queued build from a fresh service instance with the same SESSION_SECRET", async () => {
    const path = databasePath();
    const first = openDatabase(path);
    migrate(first);
    const h1 = harness();
    const serviceA = createBuildService({
      store: createBuildStore(first),
      adapter: h1.adapter,
      maxConcurrentBuilds: 1,
      sessionSecret: SECRET,
    });

    const running = await serviceA.submit(planWithSecret("first"));
    const queued = await serviceA.submit(planWithSecret("second"));
    expect(queued.status).toBe("queued");
    first.close();

    const reopened = openDatabase(path);
    migrate(reopened);
    const storeB = createBuildStore(reopened);
    const seen: BuildPlan[] = [];
    const recorder = recordingAdapter(seen);
    const serviceB = createBuildService({
      store: storeB,
      adapter: recorder.adapter,
      maxConcurrentBuilds: 1,
      sessionSecret: SECRET,
    });

    // The running build is not re-dispatched; freeing its slot lets the pump
    // claim the queued row and decrypt its payload in the new instance.
    storeB.update(running.id, { status: "succeeded" });
    await serviceB.pump();

    expect(recorder.calls()).toBe(1);
    expect(seen[0]?.files[0]?.content).toBe("root_password='second'\n");
    expect(storeB.get(queued.id)?.status).toBe("running");
    expect(storeB.get(queued.id)?.runId).toBe(`run-${queued.id}`);
    // Once dispatched, the ciphertext is gone.
    expect(storeB.readDispatchPayload(queued.id)).toBeNull();
  });

  it("keeps plan_json redacted and stores only ciphertext until dispatch", async () => {
    const db = database();
    const store = createBuildStore(db);
    const h = harness();
    const service = createBuildService({
      store,
      adapter: h.adapter,
      maxConcurrentBuilds: 1,
      sessionSecret: SECRET,
    });

    await service.submit(planWithSecret("in-flight"));
    const queued = await service.submit(planWithSecret("at-rest-secret"));

    const row = db
      .prepare("SELECT plan_json, dispatch_payload FROM builds WHERE id = ?")
      .get(queued.id) as { plan_json: string; dispatch_payload: string | null };
    expect(row.plan_json).not.toContain("at-rest-secret");
    expect(row.plan_json).toContain("<redacted at rest>");
    expect(row.dispatch_payload).toBeTruthy();
    expect(row.dispatch_payload).not.toContain("at-rest-secret");
    expect(row.dispatch_payload).not.toContain("root_password");
  });

  it("fails a queued build whose payload cannot be decrypted with this SESSION_SECRET", async () => {
    const path = databasePath();
    const first = openDatabase(path);
    migrate(first);
    const h = harness();
    const serviceA = createBuildService({
      store: createBuildStore(first),
      adapter: h.adapter,
      maxConcurrentBuilds: 1,
      sessionSecret: SECRET,
    });
    const running = await serviceA.submit(planWithSecret("first"));
    const queued = await serviceA.submit(planWithSecret("second"));
    first.close();

    const reopened = openDatabase(path);
    migrate(reopened);
    const storeB = createBuildStore(reopened);
    const seen: BuildPlan[] = [];
    const recorder = recordingAdapter(seen);
    const serviceB = createBuildService({
      store: storeB,
      adapter: recorder.adapter,
      maxConcurrentBuilds: 1,
      sessionSecret: OTHER_SECRET,
    });
    storeB.update(running.id, { status: "succeeded" });
    await serviceB.pump();

    const failed = storeB.get(queued.id)!;
    expect(recorder.calls()).toBe(0);
    expect(failed.status).toBe("failed");
    expect(failed.failure?.step).toBe("dispatch");
    expect(failed.failure?.message).toContain("cannot be decrypted");
    expect(failed.error).toContain("重新提交");
    expect(storeB.readDispatchPayload(queued.id)).toBeNull();
  });

  it("fails a queued build whose stored payload was tampered with", async () => {
    const db = database();
    const store = createBuildStore(db);
    const h = harness();
    const service = createBuildService({
      store,
      adapter: h.adapter,
      maxConcurrentBuilds: 1,
      sessionSecret: SECRET,
    });
    const running = await service.submit(planWithSecret("first"));
    const queued = await service.submit(planWithSecret("second"));

    const row = db
      .prepare("SELECT dispatch_payload FROM builds WHERE id = ?")
      .get(queued.id) as { dispatch_payload: string };
    const envelope = JSON.parse(row.dispatch_payload) as { data: string };
    const bytes = Buffer.from(envelope.data, "base64");
    bytes[0] ^= 0xff;
    db.prepare("UPDATE builds SET dispatch_payload = ? WHERE id = ?").run(
      JSON.stringify({ ...envelope, data: bytes.toString("base64") }),
      queued.id,
    );

    store.update(running.id, { status: "succeeded" });
    await service.pump();

    const failed = store.get(queued.id)!;
    expect(failed.status).toBe("failed");
    expect(failed.failure?.message).toContain("cannot be decrypted");
    expect(store.readDispatchPayload(queued.id)).toBeNull();
  });
});

describe("atomic dispatch bookkeeping (ticket 07)", () => {
  const SECRET = "s".repeat(48);

  function secretPlan(): BuildPlan {
    return {
      ...plan(),
      files: [{ path: "files/etc/uci-defaults/99-combinewrt", content: "root_password='$5$x'", mode: 0o755 }],
    } as BuildPlan;
  }

  it("writes the run id and drops the sealed payload in one store call", async () => {
    const db = database();
    const real = createBuildStore(db);
    let legacyClears = 0;
    const store: BuildStore = {
      ...real,
      clearDispatchPayload() {
        legacyClears += 1;
        throw new Error("the run-id path must not rely on the separate payload clear");
      },
    };
    const h = harness();
    const service = createBuildService({ store, adapter: h.adapter, maxConcurrentBuilds: 2, sessionSecret: SECRET });

    const build = await service.submit(secretPlan());

    expect(build.status).toBe("running");
    expect(build.runId).toBe(h.runFor(build.id));
    // The old code cleared the payload in a write of its own; if that path is
    // ever reintroduced this store would throw and the test would fail.
    expect(legacyClears).toBe(0);
    expect(real.readDispatchPayload(build.id)).toBeNull();
  });

  it("keeps a recoverable row when the run-id write dies (crash injection)", async () => {
    const db = database();
    const real = createBuildStore(db);
    let attempts = 0;
    const store: BuildStore = {
      ...real,
      recordDispatchRun() {
        attempts += 1;
        // Simulates the process dying (or the disk write failing) exactly at the
        // statement that used to be "write the run id, after clearing payload".
        throw new Error("disk I/O error: simulated crash at the run-id write");
      },
    };
    const h = harness();
    const clock = { value: new Date("2026-11-20T00:00:00.000Z") };
    const service = createBuildService({
      store,
      adapter: h.adapter,
      maxConcurrentBuilds: 2,
      sessionSecret: SECRET,
      now: () => new Date(clock.value),
    });

    const build = await service.submit(secretPlan());

    expect(attempts).toBe(1);
    const row = real.get(build.id)!;
    // The unrecoverable shape ticket 07 forbids: running with neither payload
    // nor run id. The atomic statement never committed, so the sealed plan is
    // still there and the reconciler can resolve the run through findRun.
    expect(row.status === "running" && !row.runId && real.readDispatchPayload(row.id) === null).toBe(false);
    expect(row.status).toBe("running");
    expect(row.runId).toBeNull();
    expect(real.readDispatchPayload(row.id)).not.toBeNull();

    // Restart + reconciler: once the dispatch grace expires, the build is
    // claimed by the run id that findRun resolves from the build hash.
    clock.value = new Date(Date.parse(row.dispatchedAt as string) + 3 * 60_000);
    let finds = 0;
    const recoverAdapter: BuildAdapter = {
      name: "fake",
      async findRun(buildId) {
        finds += 1;
        return `run-recovered-${buildId}`;
      },
      async dispatch() {
        throw new Error("a running build must never be re-dispatched");
      },
      async getRun() {
        return { status: "running", logTail: "" };
      },
      async downloadArtifact() {
        throw new Error("not implemented");
      },
    };
    const restarted = createBuildService({
      store: real,
      adapter: recoverAdapter,
      maxConcurrentBuilds: 2,
      sessionSecret: SECRET,
      now: () => new Date(clock.value),
    });

    const claimed = await restarted.refresh(build.id);
    expect(finds).toBe(1);
    expect(claimed?.status).toBe("running");
    expect(claimed?.runId).toBe(`run-recovered-${build.id}`);
    expect(real.readDispatchPayload(build.id)).toBeNull();
  });

  it("cancels a late run even when recording its id fails", async () => {
    const db = database();
    const real = createBuildStore(db);
    const store: BuildStore = {
      ...real,
      recordDispatchRun() {
        throw new Error("simulated crash at the in-flight run-id write");
      },
    };
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
    const record = store.list()[0]!;
    const cancelled = await service.cancel(record.id);
    expect(cancelled?.status).toBe("cancelled");

    release({ runId: "late-run-07" });
    await pending;
    await service.pump();

    // Bookkeeping crashed, but the orphan GitHub run was still cancelled.
    expect(cancelledRuns).toEqual(["late-run-07"]);
    const final = real.get(record.id)!;
    expect(final.status).toBe("cancelled");
    expect(real.readDispatchPayload(record.id)).toBeNull();
  });
});
