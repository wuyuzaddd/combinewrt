import type { DatabaseSync } from "node:sqlite";

/**
 * Persistent index for the site artifact cache (ticket 14).
 *
 * The index is a convenience for lookups and admin totals; the files on disk
 * stay authoritative. `reconcileArtifactCache` re-aligns the two after a crash
 * or a restore, so a stale row can never serve a file that is not there.
 */
export interface ArtifactCacheRow {
  buildId: string;
  filename: string;
  /** Path relative to the cache root, always `<buildId>/<filename>`. */
  relativePath: string;
  kind: string;
  size: number;
  sha256: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactCacheEntry extends ArtifactCacheRow {
  /** Absolute path on disk. */
  path: string;
}

export interface ArtifactCacheStats {
  entries: number;
  bytes: number;
}

interface RawRow {
  build_id: string;
  filename: string;
  relative_path: string;
  kind: string;
  size: number;
  sha256: string | null;
  created_at: string;
  updated_at: string;
}

function toRow(raw: RawRow): ArtifactCacheRow {
  return {
    buildId: raw.build_id,
    filename: raw.filename,
    relativePath: raw.relative_path,
    kind: raw.kind,
    size: raw.size,
    sha256: raw.sha256,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

export interface ArtifactCacheStore {
  put(row: ArtifactCacheRow): void;
  get(buildId: string, filename: string): ArtifactCacheRow | null;
  delete(buildId: string, filename: string): void;
  list(): ArtifactCacheRow[];
  totals(): ArtifactCacheStats;
}

export function createArtifactCacheStore(db: DatabaseSync): ArtifactCacheStore {
  return {
    put(row) {
      db.prepare(
        `INSERT INTO artifact_cache_entries
           (build_id, filename, relative_path, kind, size, sha256, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (build_id, filename) DO UPDATE SET
           relative_path = excluded.relative_path,
           kind = excluded.kind,
           size = excluded.size,
           sha256 = excluded.sha256,
           updated_at = excluded.updated_at`,
      ).run(
        row.buildId,
        row.filename,
        row.relativePath,
        row.kind,
        row.size,
        row.sha256,
        row.createdAt,
        row.updatedAt,
      );
    },

    get(buildId, filename) {
      const raw = db
        .prepare("SELECT * FROM artifact_cache_entries WHERE build_id = ? AND filename = ?")
        .get(buildId, filename) as RawRow | undefined;
      return raw ? toRow(raw) : null;
    },

    delete(buildId, filename) {
      db.prepare("DELETE FROM artifact_cache_entries WHERE build_id = ? AND filename = ?").run(
        buildId,
        filename,
      );
    },

    list() {
      const rows = db
        .prepare("SELECT * FROM artifact_cache_entries ORDER BY updated_at ASC")
        .all() as unknown as RawRow[];
      return rows.map(toRow);
    },

    totals() {
      const raw = db
        .prepare(
          "SELECT COUNT(*) AS entries, COALESCE(SUM(size), 0) AS bytes FROM artifact_cache_entries",
        )
        .get() as { entries: number; bytes: number };
      return { entries: raw.entries, bytes: raw.bytes };
    },
  };
}
