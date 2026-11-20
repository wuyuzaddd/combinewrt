import { randomUUID } from "node:crypto";
import type { BuildPlan } from "../build/types";
import type { DispatchPayloadCodec } from "./dispatch-payload";
import { isRedactedPlan } from "./redact";
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
 *
 * The full dispatch plan is sealed into `builds.dispatch_payload` at enqueue
 * time (`dispatch-payload.ts`) and opened only here, at dispatch time. A build
 * that is claimed later by the reconciler pump — a different module instance or
 * a fresh process — therefore still dispatches with its generated files and
 * typed network secrets, while `builds.plan_json` stays redacted.
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
  store: Pick<
    BuildStore,
    | "create"
    | "get"
    | "update"
    | "claimNextQueued"
    | "countRunning"
    | "readDispatchPayload"
    | "clearDispatchPayload"
    | "recordDispatchRun"
  >;
  adapter: BuildAdapter;
  /** Seals/opens the full plan at rest; keyed from SESSION_SECRET in production. */
  dispatchPayload: DispatchPayloadCodec;
  /** Defaults to the ticket contract value, 2. */
  maxConcurrent?: number;
  now?: () => Date;
  logger?: Pick<Console, "error">;
}

/** Build records are immutable snapshots; re-read after a claim. */
export function createBuildQueue(options: BuildQueueOptions): BuildQueue {
  const {
    store,
    adapter,
    dispatchPayload,
    maxConcurrent = 2,
    now = () => new Date(),
    logger = console,
  } = options;
  const cap = Math.max(1, Math.trunc(maxConcurrent));
  // `pump()` calls are serialised through this promise chain: the claim/count
  // check stays consistent inside one process, and the store transaction covers
  // the same guarantee across processes.
  let tail: Promise<void> = Promise.resolve();

  function enqueue(plan: BuildPlan): BuildRecord {
    const id = randomUUID();
    const timestamp = now().toISOString();
    store.create(
      {
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
      },
      // Sealed before the row is written, so a crash right after COMMIT still
      // leaves a dispatcherable build behind.
      dispatchPayload.seal(plan),
    );
    const created = store.get(id);
    if (!created) throw new Error(`build ${id} disappeared after insert`);
    return created;
  }

  /** Fail a claimed build whose payload is gone or cannot be opened, loudly. */
  function failWithoutPayload(record: BuildRecord, message: string): void {
    const latest = store.get(record.id);
    if (!latest || latest.status !== "running") {
      store.clearDispatchPayload(record.id);
      return;
    }
    store.update(
      record.id,
      {
        status: "failed",
        error:
          "构建计划的加密派发载荷缺失或无法解密，无法安全派发；请重新提交该构建",
        failure: {
          step: "dispatch",
          package: null,
          source: null,
          version: null,
          message,
        },
      },
      latest.updatedAt,
      "dispatch",
    );
    // `update()` already zeroes terminal rows; keep this call explicit so a
    // future status-handling change cannot silently retain the ciphertext.
    store.clearDispatchPayload(record.id);
  }

  async function dispatchOne(record: BuildRecord): Promise<void> {
    const sealed = store.readDispatchPayload(record.id);
    let plan: BuildPlan;
    if (sealed) {
      try {
        plan = dispatchPayload.open(sealed);
      } catch (error) {
        failWithoutPayload(
          record,
          `dispatch payload cannot be decrypted: ${error instanceof Error ? error.message : String(error)}`,
        );
        return;
      }
    } else if (isRedactedPlan(record.plan)) {
      // Legacy or manually created row: the secrets only existed in memory.
      // Never dispatch it, or the image would silently lose its files overlay.
      failWithoutPayload(record, "plan secrets are not persisted; resubmit the build");
      return;
    } else {
      // A secret-free plan needs no encrypted payload; `plan_json` is complete.
      plan = record.plan;
    }

    if (isRedactedPlan(plan)) {
      failWithoutPayload(record, "decrypted dispatch payload is still redacted; resubmit the build");
      return;
    }

    let runId: string | null = null;
    try {
      const result = await adapter.dispatch(plan, {
        buildId: record.id,
        artifactName: plan.artifactName,
      });
      runId = result.runId;
    } catch (error) {
      store.clearDispatchPayload(record.id);
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
      store.clearDispatchPayload(record.id);
      return;
    }

    const latest = store.get(record.id) ?? record;
    if (latest.status === "cancelled") {
      // Cancelled while the dispatch was in flight: record the run id and drop
      // the payload atomically (so the timeline stays complete even if we crash
      // next), then cancel the run on GitHub so it does not keep building. A
      // failed bookkeeping write must never skip the GitHub cancel.
      try {
        store.recordDispatchRun(record.id, runId, latest.updatedAt);
      } catch (error) {
        logger.error(`[combinewrt] recording the in-flight run of build ${record.id} failed`, error);
      }
      try {
        await adapter.cancelRun?.(runId);
      } catch (error) {
        logger.error(`[combinewrt] cancelling the in-flight run of build ${record.id} failed`, error);
      }
      return;
    }

    // Ticket 07: the run id and the payload clear are one `UPDATE`. A crash can
    // therefore leave at worst "running + sealed payload + no run id" — the
    // same state as a dispatch whose run GitHub has not exposed yet, which the
    // reconciler resolves with `findRun` — never "running with neither".
    try {
      // Retry once when a concurrent poll changed updated_at between our read
      // and the optimistic update; never overwrite a terminal status.
      let updated = store.recordDispatchRun(record.id, runId, latest.updatedAt);
      if (updated.runId !== runId && updated.status === "running") {
        updated = store.recordDispatchRun(record.id, runId, updated.updatedAt);
      }
    } catch (error) {
      // GitHub produced a run but the local write failed. The atomic statement
      // left the sealed payload untouched, so the row is recoverable: the
      // reconciler claims it through `findRun(hash)` / cancels it by that run
      // id. Log loudly instead of failing the pump (the build is still alive).
      logger.error(`[combinewrt] recording run ${runId} of build ${record.id} failed`, error);
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
