import { readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export interface RetentionResult {
  removed: number;
  failed: string[];
}

export function pruneArtifactCache(dir: string, days: number, now: Date = new Date()): RetentionResult {
  if (days <= 0) return { removed: 0, failed: [] };

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return { removed: 0, failed: [] };
  }

  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
  const failed: string[] = [];
  let removed = 0;

  for (const entry of entries) {
    if (!/\.zip$|\.tmp$/.test(entry)) continue;
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
}

export function readRetentionSummary(db: import("node:sqlite").DatabaseSync): RetentionSummary | null {
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
    };
  } catch {
    return null;
  }
}
