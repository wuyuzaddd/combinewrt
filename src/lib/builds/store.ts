import type { DatabaseSync } from "node:sqlite";
import type { BuildConfig, BuildPlan } from "../build/types";
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
  created_at: string;
  updated_at: string;
}

function toRecord(row: BuildRow): BuildRecord {
  return {
    id: row.id,
    plan: JSON.parse(row.plan_json) as BuildPlan,
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface BuildStore {
  create(build: BuildRecord): void;
  get(id: string): BuildRecord | null;
  list(limit?: number, offset?: number): BuildRecord[];
  count(): number;
  listActive(limit?: number): BuildRecord[];
  listEvents(id: string): BuildEvent[];
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

  return {
    create(build) {
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare(
          `INSERT INTO builds (id, plan_json, config_json, status, run_id, adapter, log_tail, error, failure_json, artifact_name, artifact_sha256, artifact_size, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          build.id,
          JSON.stringify(build.plan),
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
          build.createdAt,
          build.updatedAt,
        );
        insertEvent(build.id, null, build.status, "create", build.createdAt);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    get,
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
        .prepare("SELECT * FROM builds WHERE status IN ('queued', 'running') ORDER BY created_at ASC LIMIT ?")
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
    update(id, patch, expectedUpdatedAt, source = "poll") {
      const current = get(id);
      if (!current) throw new Error(`build ${id} does not exist`);
      let updatedAt = new Date().toISOString();
      if (updatedAt <= current.updatedAt) {
        updatedAt = new Date(Date.parse(current.updatedAt) + 1).toISOString();
      }
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
        db.exec("COMMIT");
        return next;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
