import type { DatabaseSync } from "node:sqlite";
import type { BuildPlan } from "../build/types";
import type { BuildRecord, BuildStatus } from "./types";

interface BuildRow {
  id: string;
  plan_json: string;
  status: string;
  run_id: string | null;
  adapter: string;
  log_tail: string;
  error: string | null;
  artifact_name: string | null;
  created_at: string;
  updated_at: string;
}

function toRecord(row: BuildRow): BuildRecord {
  return {
    id: row.id,
    plan: JSON.parse(row.plan_json) as BuildPlan,
    status: row.status as BuildStatus,
    runId: row.run_id,
    adapter: row.adapter as "github" | "fake",
    logTail: row.log_tail,
    error: row.error,
    artifactName: row.artifact_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface BuildStore {
  create(build: BuildRecord): void;
  get(id: string): BuildRecord | null;
  list(limit?: number): BuildRecord[];
  update(
    id: string,
    patch: Partial<Pick<BuildRecord, "status" | "runId" | "logTail" | "error" | "artifactName">>,
    expectedUpdatedAt?: string,
  ): BuildRecord;
}

export function createBuildStore(db: DatabaseSync): BuildStore {
  function get(id: string): BuildRecord | null {
    const row = db.prepare("SELECT * FROM builds WHERE id = ?").get(id) as BuildRow | undefined;
    return row ? toRecord(row) : null;
  }

  return {
    create(build) {
      db.prepare(
        `INSERT INTO builds (id, plan_json, status, run_id, adapter, log_tail, error, artifact_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        build.id,
        JSON.stringify(build.plan),
        build.status,
        build.runId,
        build.adapter,
        build.logTail,
        build.error,
        build.artifactName,
        build.createdAt,
        build.updatedAt,
      );
    },
    get,
    list(limit = 20) {
      const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 100) : 20;
      const rows = db
        .prepare("SELECT * FROM builds ORDER BY created_at DESC LIMIT ?")
        .all(safeLimit) as unknown as BuildRow[];
      return rows.map(toRecord);
    },
    update(id, patch, expectedUpdatedAt) {
      const current = get(id);
      if (!current) throw new Error(`build ${id} does not exist`);
      let updatedAt = new Date().toISOString();
      if (updatedAt <= current.updatedAt) {
        updatedAt = new Date(Date.parse(current.updatedAt) + 1).toISOString();
      }
      const next: BuildRecord = { ...current, ...patch, updatedAt };
      const sql = expectedUpdatedAt
        ? "UPDATE builds SET status = ?, run_id = ?, log_tail = ?, error = ?, artifact_name = ?, updated_at = ? WHERE id = ? AND updated_at = ?"
        : "UPDATE builds SET status = ?, run_id = ?, log_tail = ?, error = ?, artifact_name = ?, updated_at = ? WHERE id = ?";
      const params = [next.status, next.runId, next.logTail, next.error, next.artifactName, next.updatedAt, id];
      if (expectedUpdatedAt) params.push(expectedUpdatedAt);
      const result = db.prepare(sql).run(...params);
      if (Number(result.changes) === 0) {
        // Another poll won the race; return the persisted row instead of overwriting it.
        return get(id) ?? current;
      }
      return next;
    },
  };
}
