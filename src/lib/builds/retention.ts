import { readdirSync, rmdirSync, statSync, unlinkSync, type Dirent } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

const LEGACY_FLAT_ENTRY =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.zip$/;
const STAGING_DIR = ".staging";

export interface RetentionResult {
  removed: number;
  removedBytes: number;
  failed: string[];
}

export interface SizePruneResult {
  removed: number;
  removedBytes: number;
  remainingBytes: number;
}

interface ArtifactFile {
  buildId: string;
  name: string;
  path: string;
  size: number;
  mtimeMs: number;
  /** True when the file sits directly under the cache root (legacy layout). */
  flat: boolean;
}

/**
 * List artifact files in both layouts: `<root>/<buildId>/<filename>` (ticket
 * 14) and legacy `<root>/<uuid>.zip`. Staging files are never artifacts.
 */
export function listArtifactFiles(dir: string): ArtifactFile[] {
  const files: ArtifactFile[] = [];
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === STAGING_DIR) continue;
      let children: Dirent[];
      try {
        children = readdirSync(path, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const child of children) {
        if (!child.isFile()) continue;
        try {
          const stat = statSync(join(path, child.name));
          files.push({
            buildId: entry.name,
            name: child.name,
            path: join(path, child.name),
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            flat: false,
          });
        } catch {
          // raced with another cleanup; skip
        }
      }
      continue;
    }
    if (!LEGACY_FLAT_ENTRY.test(entry.name)) continue;
    try {
      const stat = statSync(path);
      files.push({
        buildId: entry.name.slice(0, -4),
        name: entry.name,
        path,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        flat: true,
      });
    } catch {
      // raced with another cleanup; skip
    }
  }

  return files;
}

/**
 * Age-based retention: remove cache artifacts older than `days`. Build records
 * and manifests live in SQLite, so deleting files never touches history and an
 * expired artifact still resolves to a readable "expired" error.
 */
export function pruneArtifactCache(
  dir: string,
  days: number,
  now: Date = new Date(),
): RetentionResult {
  const empty: RetentionResult = { removed: 0, removedBytes: 0, failed: [] };
  if (days <= 0) return empty;

  const files = listArtifactFiles(dir);
  if (files.length === 0) return empty;

  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
  const failed: string[] = [];
  let removed = 0;
  let removedBytes = 0;

  for (const file of files) {
    if (file.mtimeMs >= cutoff) continue;
    try {
      unlinkSync(file.path);
      removed += 1;
      removedBytes += file.size;
      if (!file.flat) {
        try {
          rmdirSync(join(dir, file.buildId));
        } catch {
          // another artifact still lives in this build directory
        }
      }
    } catch (error) {
      failed.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (failed.length > 0) console.warn("[combinewrt] retention could not remove some files", failed);
  return { removed, removedBytes, failed };
}

/**
 * Size-based retention: evict least-recently-used artifacts until the cache
 * fits `maxBytes`. `0` means unlimited (the default is a large ceiling, not a
 * hard requirement), so a misconfiguration cannot wipe a healthy cache.
 */
export function pruneArtifactCacheBySize(
  dir: string,
  maxBytes: number,
  _now: Date = new Date(),
): SizePruneResult {
  void _now;
  const files = listArtifactFiles(dir);
  let remainingBytes = files.reduce((total, file) => total + file.size, 0);
  if (maxBytes <= 0 || remainingBytes <= maxBytes) {
    return { removed: 0, removedBytes: 0, remainingBytes };
  }

  files.sort((a, b) => a.mtimeMs - b.mtimeMs);
  let removed = 0;
  let removedBytes = 0;
  for (const file of files) {
    if (remainingBytes <= maxBytes) break;
    try {
      unlinkSync(file.path);
      remainingBytes -= file.size;
      removed += 1;
      removedBytes += file.size;
      if (!file.flat) {
        try {
          rmdirSync(join(dir, file.buildId));
        } catch {
          // another artifact still lives in this build directory
        }
      }
    } catch (error) {
      console.warn(
        `[combinewrt] size retention could not remove ${file.name}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return { removed, removedBytes, remainingBytes };
}

export interface RetentionSummary {
  at: string;
  removed: number;
  /** Bytes removed by this cleanup; absent in summaries written before ticket 14. */
  removedBytes?: number;
  /** Cache bytes left after cleanup. */
  remainingBytes?: number;
  /** Cache entry count left after cleanup. */
  entries?: number;
  failed: string[];
  error?: string;
}

export function recordRetention(db: DatabaseSync, summary: RetentionSummary): void {
  db.prepare(
    "INSERT INTO app_meta (key, value) VALUES ('retention.last', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify(summary));
}

export function readRetentionSummary(db: DatabaseSync): RetentionSummary | null {
  const row = db.prepare("SELECT value FROM app_meta WHERE key = 'retention.last'").get() as
    | { value: string }
    | undefined;
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value) as RetentionSummary;
    return {
      at: parsed.at,
      removed: Number(parsed.removed) || 0,
      failed: Array.isArray(parsed.failed) ? parsed.failed.map(String) : [],
      ...(typeof parsed.removedBytes === "number" ? { removedBytes: parsed.removedBytes } : {}),
      ...(typeof parsed.remainingBytes === "number"
        ? { remainingBytes: parsed.remainingBytes }
        : {}),
      ...(typeof parsed.entries === "number" ? { entries: parsed.entries } : {}),
      ...(typeof parsed.error === "string" ? { error: parsed.error } : {}),
    };
  } catch {
    return null;
  }
}
