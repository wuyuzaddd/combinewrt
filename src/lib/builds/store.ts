import type { DatabaseSync } from "node:sqlite";
import type { BuildConfig } from "../build/types";
import { parseBuildPlanJson } from "../domain/build-plan";
import { redactPlanForStorage } from "./redact";

import type { BuildEvent, BuildEventSource, BuildFailure, BuildRecord, BuildStatus } from "./types";

interface BuildRow {
  id: string;
  plan_json: string;
  config_json: string | null;
  status: string;
  run_id: string | null;
  adapter: string;
  log_tail: string;
  error: string | null;
  failure_json: string | null;
  artifact_name: string | null;
  artifact_sha256: string | null;
  artifact_size: number | null;
  engine: string | null;
  target: string | null;
  dispatched_at: string | null;
  created_at: string;
  updated_at: string;
  dispatch_payload: string | null;
}

function toRecord(row: BuildRow): BuildRecord {
  return {
    id: row.id,
    plan: parseBuildPlanJson(row.plan_json).plan,
    config: row.config_json ? (JSON.parse(row.config_json) as BuildConfig) : null,
    status: row.status as BuildStatus,
    runId: row.run_id,
    adapter: row.adapter as "github" | "fake",
    logTail: row.log_tail,
    error: row.error,
    failure: row.failure_json ? (JSON.parse(row.failure_json) as BuildFailure) : null,
    artifactName: row.artifact_name,
    artifactSha256: row.artifact_sha256,
    artifactSize: row.artifact_size,
    engine: (row.engine as BuildRecord["engine"]) ?? null,
    target: row.target ?? null,
    dispatchedAt: row.dispatched_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Keep `updated_at` strictly increasing even when two writes share a millisecond. */
function nextUpdatedAt(previous: string, timestamp: string): string {
  if (timestamp > previous) return timestamp;
  return new Date(Date.parse(previous) + 1).toISOString();
}

export interface BuildStore {
  /**
   * Insert a queued build. `dispatchPayload` is the sealed full plan (see
   * `dispatch-payload.ts`); it is kept out of `BuildRecord` so it never reaches
   * an API response or a detail page.
   */
  create(build: BuildRecord, dispatchPayload?: string | null): void;
  /** Read the sealed dispatch payload, or null when the row has none. */
  readDispatchPayload(id: string): string | null;
  /** Zero the sealed payload once it has been dispatched or is no longer needed. */
  clearDispatchPayload(id: string): void;
  /**
   * Record the GitHub run id and drop the sealed dispatch payload in a single
   * `UPDATE` (ticket 07). The old code cleared the payload and then wrote the
   * run id in two statements, so a crash in between left a `running` row with
   * neither payload nor run id, which the reconciler could neither claim nor
   * cancel. One statement removes that window: the row either keeps the sealed
   * plan (recoverable) or has its run id.
   */
  recordDispatchRun(id: string, runId: string, expectedUpdatedAt?: string): BuildRecord;
  get(id: string): BuildRecord | null;
  list(limit?: number, offset?: number): BuildRecord[];
  count(): number;
  listActive(limit?: number): BuildRecord[];
  listEvents(id: string): BuildEvent[];
  /**
   * Atomically claim the oldest queued build for dispatch (ticket 13). Returns
   * null when the running cap is reached or the queue is empty. The claim is a
   * single `BEGIN IMMEDIATE` transaction, so two server processes (or a restart
   * racing a submit) can never claim the same row or exceed the cap.
   */
  claimNextQueued(maxRunning: number, timestamp: string): BuildRecord | null;
  /** Number of builds that are currently dispatched (claimed or running). */
  countRunning(): number;
  /**
   * 1-based position in the waiting queue, or null when the build is not queued.
   * Used by the build detail page to answer "how much longer?" (ticket 15).
   */
  queuePosition(id: string): number | null;
  update(
    id: string,
    patch: Partial<
      Pick<
        BuildRecord,
        "status" | "runId" | "logTail" | "error" | "failure" | "artifactName" | "artifactSha256" | "artifactSize"
      >
    >,
    expectedUpdatedAt?: string,
    source?: BuildEventSource,
  ): BuildRecord;
}

export function createBuildStore(db: DatabaseSync): BuildStore {
  function get(id: string): BuildRecord | null {
    const row = db.prepare("SELECT * FROM builds WHERE id = ?").get(id) as BuildRow | undefined;
    return row ? toRecord(row) : null;
  }

  function insertEvent(
    buildId: string,
    fromStatus: BuildStatus | null,
    toStatus: BuildStatus,
    source: BuildEventSource,
    createdAt: string,
  ): void {
    db.prepare(
      "INSERT INTO build_events (build_id, from_status, to_status, source, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(buildId, fromStatus, toStatus, source, createdAt);
  }

  function countRunning(): number {
    const row = db.prepare("SELECT COUNT(*) AS total FROM builds WHERE status = 'running'").get() as {
      total: number;
    };
    return Number(row.total);
  }

  function queuePosition(id: string): number | null {
    const record = get(id);
    if (!record || record.status !== "queued") return null;
    const row = db
      .prepare(
        `SELECT COUNT(*) AS total FROM builds
          WHERE status = 'queued'
            AND (created_at < ? OR (created_at = ? AND rowid < (SELECT rowid FROM builds WHERE id = ?)))`,
      )
      .get(record.createdAt, record.createdAt, id) as { total: number };
    return Number(row.total) + 1;
  }

  return {
    create(build, dispatchPayload = null) {
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare(
          `INSERT INTO builds (id, plan_json, config_json, status, run_id, adapter, log_tail, error, failure_json, artifact_name, artifact_sha256, artifact_size, engine, target, dispatched_at, created_at, updated_at, dispatch_payload)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          build.id,
          JSON.stringify(redactPlanForStorage(build.plan)),
          build.config ? JSON.stringify(build.config) : null,
          build.status,
          build.runId,
          build.adapter,
          build.logTail,
          build.error,
          build.failure ? JSON.stringify(build.failure) : null,
          build.artifactName,
          build.artifactSha256 ?? null,
          build.artifactSize ?? null,
          build.engine ?? null,
          build.target ?? null,
          build.dispatchedAt ?? null,
          build.createdAt,
          build.updatedAt,
          dispatchPayload,
        );
        insertEvent(build.id, null, build.status, "create", build.createdAt);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    get,
    readDispatchPayload(id) {
      const row = db
        .prepare("SELECT dispatch_payload FROM builds WHERE id = ?")
        .get(id) as { dispatch_payload: string | null } | undefined;
      return row?.dispatch_payload ?? null;
    },
    clearDispatchPayload(id) {
      db.prepare("UPDATE builds SET dispatch_payload = NULL WHERE id = ?").run(id);
    },
    recordDispatchRun(id, runId, expectedUpdatedAt) {
      const current = get(id);
      if (!current) throw new Error(`build ${id} does not exist`);
      const updatedAt = nextUpdatedAt(current.updatedAt, new Date().toISOString());
      const sql = expectedUpdatedAt
        ? "UPDATE builds SET run_id = ?, dispatch_payload = NULL, updated_at = ? WHERE id = ? AND updated_at = ?"
        : "UPDATE builds SET run_id = ?, dispatch_payload = NULL, updated_at = ? WHERE id = ?";
      const params: Array<string | null> = [runId, updatedAt, id];
      if (expectedUpdatedAt) params.push(expectedUpdatedAt);

      // No explicit transaction is needed: a single `UPDATE` is atomic, and it
      // is exactly the property ticket 07 relies on.
      const result = db.prepare(sql).run(...params);
      if (Number(result.changes) === 0) {
        // Another poll won the race; hand back the persisted row so the caller
        // can retry against its fresh `updated_at` instead of overwriting it.
        return get(id) ?? current;
      }
      return { ...current, runId, updatedAt };
    },
    list(limit = 20, offset = 0) {
      const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 100) : 20;
      const safeOffset = Number.isFinite(offset) ? Math.max(Math.trunc(offset), 0) : 0;
      const rows = db
        .prepare("SELECT * FROM builds ORDER BY created_at DESC LIMIT ? OFFSET ?")
        .all(safeLimit, safeOffset) as unknown as BuildRow[];
      return rows.map(toRecord);
    },
    count() {
      const row = db.prepare("SELECT COUNT(*) AS total FROM builds").get() as { total: number };
      return Number(row.total);
    },
    listActive(limit = 20) {
      const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 100) : 20;
      const rows = db
        .prepare(
          "SELECT * FROM builds WHERE status IN ('queued', 'running') ORDER BY created_at ASC, rowid ASC LIMIT ?",
        )
        .all(safeLimit) as unknown as BuildRow[];
      return rows.map(toRecord);
    },
    listEvents(id) {
      const rows = db
        .prepare(
          "SELECT id, build_id, from_status, to_status, source, created_at FROM build_events WHERE build_id = ? ORDER BY id ASC",
        )
        .all(id) as unknown as Array<{
        id: number;
        build_id: string;
        from_status: string | null;
        to_status: string;
        source: string;
        created_at: string;
      }>;
      return rows.map((row) => ({
        id: row.id,
        buildId: row.build_id,
        fromStatus: row.from_status as BuildStatus | null,
        toStatus: row.to_status as BuildStatus,
        source: row.source as BuildEventSource,
        createdAt: row.created_at,
      }));
    },
    claimNextQueued(maxRunning, timestamp) {
      const cap = Math.max(1, Math.trunc(maxRunning));
      db.exec("BEGIN IMMEDIATE");
      try {
        if (countRunning() >= cap) {
          db.exec("COMMIT");
          return null;
        }
        const row = db
          .prepare("SELECT * FROM builds WHERE status = 'queued' ORDER BY created_at ASC, rowid ASC LIMIT 1")
          .get() as BuildRow | undefined;
        if (!row) {
          db.exec("COMMIT");
          return null;
        }
        const updatedAt = nextUpdatedAt(row.updated_at, timestamp);
        const result = db
          .prepare(
            "UPDATE builds SET status = 'running', dispatched_at = ?, updated_at = ? WHERE id = ? AND status = 'queued'",
          )
          .run(timestamp, updatedAt, row.id);
        if (Number(result.changes) === 0) {
          db.exec("ROLLBACK");
          return null;
        }
        insertEvent(row.id, "queued", "running", "dispatch", updatedAt);
        db.exec("COMMIT");
        return get(row.id);
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    countRunning,
    queuePosition,
    update(id, patch, expectedUpdatedAt, source = "poll") {
      const current = get(id);
      if (!current) throw new Error(`build ${id} does not exist`);
      const updatedAt = nextUpdatedAt(current.updatedAt, new Date().toISOString());
      const next: BuildRecord = { ...current, ...patch, updatedAt };
      const sql = expectedUpdatedAt
        ? "UPDATE builds SET status = ?, run_id = ?, log_tail = ?, error = ?, failure_json = ?, artifact_name = ?, artifact_sha256 = ?, artifact_size = ?, updated_at = ? WHERE id = ? AND updated_at = ?"
        : "UPDATE builds SET status = ?, run_id = ?, log_tail = ?, error = ?, failure_json = ?, artifact_name = ?, artifact_sha256 = ?, artifact_size = ?, updated_at = ? WHERE id = ?";
      const params = [
        next.status,
        next.runId,
        next.logTail,
        next.error,
        next.failure ? JSON.stringify(next.failure) : null,
        next.artifactName,
        next.artifactSha256 ?? null,
        next.artifactSize ?? null,
        next.updatedAt,
        id,
      ];
      if (expectedUpdatedAt) params.push(expectedUpdatedAt);

      db.exec("BEGIN IMMEDIATE");
      try {
        const result = db.prepare(sql).run(...params);
        if (Number(result.changes) === 0) {
          db.exec("ROLLBACK");
          // Another poll won the race; return the persisted row instead of overwriting it.
          return get(id) ?? current;
        }
        if (next.status !== current.status) {
          insertEvent(id, current.status, next.status, source, next.updatedAt);
        }
        // A terminal build never needs its sealed dispatch payload again; keep
        // the ciphertext out of backups as soon as the build stops moving.
        if (next.status === "succeeded" || next.status === "failed" || next.status === "cancelled") {
          db.prepare("UPDATE builds SET dispatch_payload = NULL WHERE id = ?").run(id);
        } else if (next.runId && !current.runId) {
          // A run id means the dispatcher already consumed the payload. This is
          // the reconciler's `findRun` claim path (the queue writes both fields
          // atomically in `recordDispatchRun`); same transaction, same cleanup.
          db.prepare("UPDATE builds SET dispatch_payload = NULL WHERE id = ?").run(id);
        }
        db.exec("COMMIT");
        return next;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
