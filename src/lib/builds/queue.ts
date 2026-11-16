import { randomUUID } from "node:crypto";
import type { BuildPlan } from "../build/types";
import type { BuildStore } from "./store";
import type { BuildAdapter, BuildRecord } from "./types";
import { buildEngineOf, buildTargetOf } from "./types";

/**
 * SQLite-backed build queue (ticket 13).
 *
 * `builds.status` is the queue state machine: `queued` waits for a dispatch
 * slot, `running` means the build was claimed and a GitHub run is (or will
 * shortly be) recorded. `builds` is the single source of truth; there is no
 * in-memory queue, so a restart loses nothing.
 */
export interface BuildQueue {
  /** Configured concurrency cap (`MAX_CONCURRENT_BUILDS`). */
  readonly maxConcurrent: number;
  /** Create a queued build row. Never dispatches. */
  enqueue(plan: BuildPlan): BuildRecord;
  /** Dispatch queued builds FIFO until the cap is reached. */
  pump(): Promise<void>;
  /** Builds currently claimed for dispatch. */
  runningCount(): number;
}

export interface BuildQueueOptions {
  store: Pick<BuildStore, "create" | "get" | "update" | "claimNextQueued" | "countRunning">;
  adapter: BuildAdapter;
  /** Defaults to the ticket contract value, 2. */
  maxConcurrent?: number;
  now?: () => Date;
  logger?: Pick<Console, "error">;
}

/** Build records are immutable snapshots; re-read after a claim. */
export function createBuildQueue(options: BuildQueueOptions): BuildQueue {
  const { store, adapter, maxConcurrent = 2, now = () => new Date(), logger = console } = options;
  const cap = Math.max(1, Math.trunc(maxConcurrent));
  // `pump()` calls are serialised through this promise chain: the claim/count
  // check stays consistent inside one process, and the store transaction covers
  // the same guarantee across processes.
  let tail: Promise<void> = Promise.resolve();

  function enqueue(plan: BuildPlan): BuildRecord {
    const id = randomUUID();
    const timestamp = now().toISOString();
    store.create({
      id,
      plan,
      config: plan.config ?? null,
      status: "queued",
      runId: null,
      adapter: adapter.name,
      logTail: "",
      error: null,
      artifactName: null,
      artifactSha256: null,
      artifactSize: null,
      engine: buildEngineOf(plan),
      target: buildTargetOf(plan),
      dispatchedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const created = store.get(id);
    if (!created) throw new Error(`build ${id} disappeared after insert`);
    return created;
  }

  async function dispatchOne(record: BuildRecord): Promise<void> {
    let runId: string | null = null;
    try {
      const result = await adapter.dispatch(record.plan, {
        buildId: record.id,
        artifactName: record.plan.artifactName,
      });
      runId = result.runId;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const latest = store.get(record.id);
      // A cancel during the dispatch call wins: it is already terminal.
      if (!latest || latest.status !== "running") return;
      store.update(
        record.id,
        {
          status: "failed",
          error: message,
          failure: { step: "dispatch", package: null, source: null, version: null, message },
        },
        latest.updatedAt,
        "dispatch",
      );
      return;
    }

    if (!runId) {
      // The dispatch call succeeded but GitHub has not exposed the run yet; the
      // reconciler resolves it through findRun and fails the build if the run
      // never appears, so no phantom run is invented here.
      return;
    }

    const latest = store.get(record.id) ?? record;
    if (latest.status === "cancelled") {
      // Cancelled while the dispatch was in flight: record the run id (so the
      // timeline is complete) and cancel it on GitHub so it does not keep running.
      store.update(record.id, { runId }, latest.updatedAt, "cancel");
      try {
        await adapter.cancelRun?.(runId);
      } catch (error) {
        logger.error(`[combinewrt] cancelling the in-flight run of build ${record.id} failed`, error);
      }
      return;
    }

    // Retry once when a concurrent poll changed updated_at between our read and
    // the optimistic update; never overwrite a terminal status.
    let updated = store.update(record.id, { runId }, latest.updatedAt, "dispatch");
    if (updated.runId !== runId && updated.status === "running") {
      updated = store.update(record.id, { runId }, updated.updatedAt, "dispatch");
    }
  }

  async function drain(): Promise<void> {
    for (;;) {
      const claimed = store.claimNextQueued(cap, now().toISOString());
      if (!claimed) return;
      await dispatchOne(claimed);
    }
  }

  function pump(): Promise<void> {
    const next = tail.then(drain, drain);
    // The shared tail never rejects, so one failed pump cannot poison the chain;
    // the caller still receives this pump's rejection.
    tail = next.catch(() => {});
    return next;
  }

  return {
    maxConcurrent: cap,
    enqueue,
    pump,
    runningCount: () => store.countRunning(),
  };
}
