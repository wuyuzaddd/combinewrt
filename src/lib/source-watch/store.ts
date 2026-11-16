import type { DatabaseSync } from "node:sqlite";
import type {
  PinEventReason,
  PinStatus,
  SourcePinEvent,
  SourcePinRecord,
  SourceWatchState,
  WatchCandidateReason,
  WatchSourceId,
} from "./types";

interface SourcePinRow {
  id: number;
  source: WatchSourceId;
  status: PinStatus;
  value: string;
  observed_at: string | null;
  adopted_at: string | null;
  adopted_by: string | null;
  cache_path: string | null;
  cache_sha256: string | null;
  metadata_json: string | null;
}

interface SourcePinEventRow {
  id: number;
  source: WatchSourceId;
  from_pin: string | null;
  to_pin: string | null;
  reason: PinEventReason;
  snapshot_id: number | null;
  created_at: string;
}

interface SourceWatchStateRow {
  source: WatchSourceId;
  last_check_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  candidate_reason: WatchCandidateReason | null;
  updated_at: string | null;
}

function parseMetadata(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function toPin(row: SourcePinRow): SourcePinRecord {
  return {
    id: Number(row.id),
    source: row.source,
    status: row.status,
    value: row.value,
    observedAt: row.observed_at,
    adoptedAt: row.adopted_at,
    adoptedBy: row.adopted_by,
    cachePath: row.cache_path,
    cacheSha256: row.cache_sha256,
    metadata: parseMetadata(row.metadata_json),
  };
}

function toEvent(row: SourcePinEventRow): SourcePinEvent {
  return {
    id: Number(row.id),
    source: row.source,
    fromPin: row.from_pin,
    toPin: row.to_pin,
    reason: row.reason,
    snapshotId: row.snapshot_id === null ? null : Number(row.snapshot_id),
    createdAt: row.created_at,
  };
}

export interface SourcePinInput {
  source: WatchSourceId;
  status: PinStatus;
  value: string;
  observedAt?: string | null;
  adoptedAt?: string | null;
  adoptedBy?: string | null;
  cachePath?: string | null;
  cacheSha256?: string | null;
  metadata?: Record<string, unknown>;
}

export function readSourcePin(
  db: DatabaseSync,
  source: WatchSourceId,
  status: PinStatus,
): SourcePinRecord | null {
  const row = db
    .prepare("SELECT * FROM source_pins WHERE source = ? AND status = ?")
    .get(source, status) as SourcePinRow | undefined;
  return row ? toPin(row) : null;
}

export function listSourcePins(db: DatabaseSync): SourcePinRecord[] {
  const rows = db
    .prepare("SELECT * FROM source_pins ORDER BY source, status")
    .all() as unknown as SourcePinRow[];
  return rows.map(toPin);
}

export function upsertSourcePin(db: DatabaseSync, input: SourcePinInput): void {
  db.prepare(
    `INSERT INTO source_pins
       (source, status, value, observed_at, adopted_at, adopted_by, cache_path, cache_sha256, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (source, status) DO UPDATE SET
       value = excluded.value,
       observed_at = excluded.observed_at,
       adopted_at = excluded.adopted_at,
       adopted_by = excluded.adopted_by,
       cache_path = excluded.cache_path,
       cache_sha256 = excluded.cache_sha256,
       metadata_json = excluded.metadata_json`,
  ).run(
    input.source,
    input.status,
    input.value,
    input.observedAt ?? null,
    input.adoptedAt ?? null,
    input.adoptedBy ?? null,
    input.cachePath ?? null,
    input.cacheSha256 ?? null,
    JSON.stringify(input.metadata ?? {}),
  );
}

export function deleteSourcePin(
  db: DatabaseSync,
  source: WatchSourceId,
  status: PinStatus,
): void {
  db.prepare("DELETE FROM source_pins WHERE source = ? AND status = ?").run(source, status);
}

export function insertSourcePinEvent(
  db: DatabaseSync,
  input: {
    source: WatchSourceId;
    fromPin: string | null;
    toPin: string | null;
    reason: PinEventReason;
    snapshotId?: number | null;
    createdAt: string;
  },
): number {
  const result = db
    .prepare(
      `INSERT INTO source_pin_events (source, from_pin, to_pin, reason, snapshot_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.source,
      input.fromPin,
      input.toPin,
      input.reason,
      input.snapshotId ?? null,
      input.createdAt,
    );
  return Number(result.lastInsertRowid);
}

export function listSourcePinEvents(
  db: DatabaseSync,
  source: WatchSourceId,
  limit = 20,
): SourcePinEvent[] {
  const rows = db
    .prepare("SELECT * FROM source_pin_events WHERE source = ? ORDER BY id DESC LIMIT ?")
    .all(source, limit) as unknown as SourcePinEventRow[];
  return rows.map(toEvent);
}

function emptyState(source: WatchSourceId): SourceWatchState {
  return {
    source,
    lastCheckAt: null,
    lastSuccessAt: null,
    lastError: null,
    candidateReason: null,
    updatedAt: null,
  };
}

export function readSourceWatchState(db: DatabaseSync, source: WatchSourceId): SourceWatchState {
  const row = db
    .prepare("SELECT * FROM source_watch_state WHERE source = ?")
    .get(source) as SourceWatchStateRow | undefined;
  if (!row) return emptyState(source);
  return {
    source: row.source,
    lastCheckAt: row.last_check_at,
    lastSuccessAt: row.last_success_at,
    lastError: row.last_error,
    candidateReason: row.candidate_reason,
    updatedAt: row.updated_at,
  };
}

export function writeSourceWatchState(db: DatabaseSync, state: SourceWatchState): void {
  db.prepare(
    `INSERT INTO source_watch_state
       (source, last_check_at, last_success_at, last_error, candidate_reason, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (source) DO UPDATE SET
       last_check_at = excluded.last_check_at,
       last_success_at = excluded.last_success_at,
       last_error = excluded.last_error,
       candidate_reason = excluded.candidate_reason,
       updated_at = excluded.updated_at`,
  ).run(
    state.source,
    state.lastCheckAt,
    state.lastSuccessAt,
    state.lastError,
    state.candidateReason,
    state.updatedAt ?? new Date().toISOString(),
  );
}

export function patchSourceWatchState(
  db: DatabaseSync,
  source: WatchSourceId,
  patch: Partial<Omit<SourceWatchState, "source" | "updatedAt">>,
  updatedAt: string,
): SourceWatchState {
  const next: SourceWatchState = {
    ...readSourceWatchState(db, source),
    ...patch,
    source,
    updatedAt,
  };
  writeSourceWatchState(db, next);
  return next;
}

/** Run synchronous SQLite work atomically. File caching happens before/after. */
export function inTransaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec("BEGIN");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
