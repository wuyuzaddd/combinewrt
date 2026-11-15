import type { DatabaseSync } from "node:sqlite";
import type {
  SupplementPublishEvent,
  SupplementPublishRecord,
  SupplementPublishStatus,
  SupplementPublishTrigger,
} from "./types";
import type { PublishGateReason, PublishMode } from "./recipe";

interface Row {
  [key: string]: unknown;
}

export function toRecord(row: Row): SupplementPublishRecord {
  return {
    id: Number(row.id),
    baseVersion: String(row.base_version),
    target: String(row.target),
    sourceCommit: String(row.source_commit),
    recipeHash: String(row.recipe_hash),
    spdx: String(row.spdx),
    publicAllowed: Number(row.public_allowed) === 1,
    packageSetShape: JSON.parse(String(row.package_set_shape)) as string[],
    metadataFingerprint: String(row.metadata_fingerprint),
    publishMode: String(row.publish_mode) as PublishMode,
    gateReason: String(row.gate_reason) as PublishGateReason,
    trigger: String(row.trigger) as SupplementPublishTrigger,
    buildRunId: row.build_run_id === null || row.build_run_id === undefined ? null : String(row.build_run_id),
    buildRunUrl: row.build_run_url === null || row.build_run_url === undefined ? null : String(row.build_run_url),
    status: String(row.status) as SupplementPublishStatus,
    reason: row.reason === null || row.reason === undefined ? null : String(row.reason),
    indexSha256: row.index_sha256 === null || row.index_sha256 === undefined ? null : String(row.index_sha256),
    keyFingerprint:
      row.key_fingerprint === null || row.key_fingerprint === undefined ? null : String(row.key_fingerprint),
    frozenPath: row.frozen_path === null || row.frozen_path === undefined ? null : String(row.frozen_path),
    promotedAt: row.promoted_at === null || row.promoted_at === undefined ? null : String(row.promoted_at),
    promotedBy: row.promoted_by === null || row.promoted_by === undefined ? null : String(row.promoted_by),
    attempts: Number(row.attempts),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

const COLUMN_OF: Record<string, string> = {
  baseVersion: "base_version",
  target: "target",
  sourceCommit: "source_commit",
  recipeHash: "recipe_hash",
  spdx: "spdx",
  publicAllowed: "public_allowed",
  packageSetShape: "package_set_shape",
  metadataFingerprint: "metadata_fingerprint",
  publishMode: "publish_mode",
  gateReason: "gate_reason",
  trigger: "trigger",
  buildRunId: "build_run_id",
  buildRunUrl: "build_run_url",
  status: "status",
  reason: "reason",
  indexSha256: "index_sha256",
  keyFingerprint: "key_fingerprint",
  frozenPath: "frozen_path",
  promotedAt: "promoted_at",
  promotedBy: "promoted_by",
  attempts: "attempts",
};

function toColumnValue(key: string, value: unknown): unknown {
  if (key === "publicAllowed") return value ? 1 : 0;
  if (key === "packageSetShape") return JSON.stringify(value);
  return value ?? null;
}

export interface SupplementPublishInsert {
  baseVersion: string;
  target: string;
  sourceCommit: string;
  recipeHash: string;
  spdx: string;
  publicAllowed: boolean;
  packageSetShape: string[];
  metadataFingerprint: string;
  publishMode: PublishMode;
  gateReason: PublishGateReason;
  trigger: SupplementPublishTrigger;
  status: SupplementPublishStatus;
  buildRunId?: string | null;
  buildRunUrl?: string | null;
  reason?: string | null;
  now: string;
}

/**
 * Insert the publish attempt for a candidate, or return the attempt that
 * already exists for the same (base_version, source_commit) pair. The second
 * caller gets `created: false`, which is how duplicate watch ticks and webhook
 * deliveries are collapsed without a second dispatch.
 */
export function insertOrReadSupplementPublish(
  db: DatabaseSync,
  input: SupplementPublishInsert,
): { record: SupplementPublishRecord; created: boolean } {
  const existing = readSupplementPublishByCommit(db, input.baseVersion, input.sourceCommit);
  if (existing) return { record: existing, created: false };

  const result = db
    .prepare(
      `INSERT INTO supplement_publishes
         (base_version, target, source_commit, recipe_hash, spdx, public_allowed,
          package_set_shape, metadata_fingerprint, publish_mode, gate_reason, trigger,
          build_run_id, build_run_url, status, reason, attempts, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(
      input.baseVersion,
      input.target,
      input.sourceCommit,
      input.recipeHash,
      input.spdx,
      input.publicAllowed ? 1 : 0,
      JSON.stringify(input.packageSetShape),
      input.metadataFingerprint,
      input.publishMode,
      input.gateReason,
      input.trigger,
      input.buildRunId ?? null,
      input.buildRunUrl ?? null,
      input.status,
      input.reason ?? null,
      input.now,
      input.now,
    );

  return { record: readSupplementPublish(db, Number(result.lastInsertRowid)) as SupplementPublishRecord, created: true };
}

export function readSupplementPublish(db: DatabaseSync, id: number): SupplementPublishRecord | null {
  const row = db.prepare("SELECT * FROM supplement_publishes WHERE id = ?").get(id) as Row | undefined;
  return row ? toRecord(row) : null;
}

export function readSupplementPublishByCommit(
  db: DatabaseSync,
  baseVersion: string,
  sourceCommit: string,
): SupplementPublishRecord | null {
  const row = db
    .prepare("SELECT * FROM supplement_publishes WHERE base_version = ? AND source_commit = ?")
    .get(baseVersion, sourceCommit) as Row | undefined;
  return row ? toRecord(row) : null;
}

export function readLatestSupplementPublish(
  db: DatabaseSync,
  baseVersion: string,
  target: string,
): SupplementPublishRecord | null {
  const row = db
    .prepare(
      `SELECT * FROM supplement_publishes
       WHERE base_version = ? AND target = ?
       ORDER BY id DESC LIMIT 1`,
    )
    .get(baseVersion, target) as Row | undefined;
  return row ? toRecord(row) : null;
}

export function readLatestLiveSupplementPublish(
  db: DatabaseSync,
  baseVersion: string,
  target: string,
): SupplementPublishRecord | null {
  const row = db
    .prepare(
      `SELECT * FROM supplement_publishes
       WHERE base_version = ? AND target = ? AND status = 'published' AND publish_mode = 'live'
       ORDER BY id DESC LIMIT 1`,
    )
    .get(baseVersion, target) as Row | undefined;
  return row ? toRecord(row) : null;
}

export function listSupplementPublishes(
  db: DatabaseSync,
  options: { baseVersion?: string; target?: string; limit?: number } = {},
): SupplementPublishRecord[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (options.baseVersion) {
    clauses.push("base_version = ?");
    params.push(options.baseVersion);
  }
  if (options.target) {
    clauses.push("target = ?");
    params.push(options.target);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  params.push(options.limit ?? 20);
  const rows = db
    .prepare(`SELECT * FROM supplement_publishes ${where} ORDER BY id DESC LIMIT ?`)
    .all(...(params as never[])) as Row[];
  return rows.map(toRecord);
}

/** Statuses that still need a run-state or publish-audit check. */
export const UNRESOLVED_STATUSES: SupplementPublishStatus[] = ["dispatched", "running", "publish_pending"];

export function listUnresolvedPublishes(db: DatabaseSync, limit = 10): SupplementPublishRecord[] {
  const rows = db
    .prepare(
      `SELECT * FROM supplement_publishes
       WHERE status IN ('dispatched', 'running', 'publish_pending')
       ORDER BY id ASC LIMIT ?`,
    )
    .all(limit) as Row[];
  return rows.map(toRecord);
}

export function updateSupplementPublish(
  db: DatabaseSync,
  id: number,
  patch: Record<string, unknown>,
  now: string,
): SupplementPublishRecord {
  const assignments: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    const column = COLUMN_OF[key];
    if (!column) continue;
    assignments.push(`${column} = ?`);
    values.push(toColumnValue(key, value));
  }
  assignments.push("updated_at = ?");
  values.push(now);
  values.push(id);
  db.prepare(`UPDATE supplement_publishes SET ${assignments.join(", ")} WHERE id = ?`).run(
    ...(values as never[]),
  );
  return readSupplementPublish(db, id) as SupplementPublishRecord;
}

export function insertSupplementPublishEvent(
  db: DatabaseSync,
  input: {
    publishId: number;
    fromStatus: SupplementPublishStatus | null;
    toStatus: SupplementPublishStatus;
    reason?: string | null;
    detail?: Record<string, unknown>;
    now: string;
  },
): void {
  db.prepare(
    `INSERT INTO supplement_publish_events
       (publish_id, from_status, to_status, reason, detail_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    input.publishId,
    input.fromStatus,
    input.toStatus,
    input.reason ?? null,
    JSON.stringify(input.detail ?? {}),
    input.now,
  );
}

export function listSupplementPublishEvents(
  db: DatabaseSync,
  publishId: number,
  limit = 20,
): SupplementPublishEvent[] {
  const rows = db
    .prepare(
      `SELECT * FROM supplement_publish_events
       WHERE publish_id = ? ORDER BY id DESC LIMIT ?`,
    )
    .all(publishId, limit) as Row[];
  return rows.map((row) => ({
    id: Number(row.id),
    publishId: Number(row.publish_id),
    fromStatus: row.from_status === null ? null : (String(row.from_status) as SupplementPublishStatus),
    toStatus: String(row.to_status) as SupplementPublishStatus,
    reason: row.reason === null ? null : String(row.reason),
    detail: JSON.parse(String(row.detail_json)) as Record<string, unknown>,
    createdAt: String(row.created_at),
  }));
}
