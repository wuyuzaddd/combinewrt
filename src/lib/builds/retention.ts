import { readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

const CACHE_ENTRY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.zip(\.|$)/;

export interface RetentionResult {
  removed: number;
  failed: string[];
}

export function pruneArtifactCache(dir: string, days: number, now: Date = new Date()): RetentionResult {
  if (days <= 0) return { removed: 0, failed: [] };

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { removed: 0, failed: [] };
    const message = `${dir}: ${error instanceof Error ? error.message : String(error)}`;
    console.warn("[combinewrt] retention could not read the artifact cache", message);
    return { removed: 0, failed: [message] };
  }

  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
  const failed: string[] = [];
  let removed = 0;

  for (const entry of entries) {
    if (!CACHE_ENTRY.test(entry)) continue;
    const path = join(dir, entry);
    try {
      if (statSync(path).mtimeMs >= cutoff) continue;
      unlinkSync(path);
      removed += 1;
    } catch (error) {
      failed.push(`${entry}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (failed.length > 0) console.warn("[combinewrt] retention could not remove some files", failed);
  return { removed, failed };
}

export interface RetentionSummary {
  at: string;
  removed: number;
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
      ...(typeof parsed.error === "string" ? { error: parsed.error } : {}),
    };
  } catch {
    return null;
  }
}
