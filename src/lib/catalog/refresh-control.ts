import type { DatabaseSync } from "node:sqlite";
import type { RefreshResult } from "./service";

export interface CatalogRefreshState {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  snapshotId: number | null;
}

export interface CatalogRefreshOutcome {
  ran: boolean;
  reason?: "fresh" | "in-flight";
  result?: RefreshResult;
  error?: string;
}

const STATE_KEY = "catalog.refresh.state";
export const CATALOG_REFRESH_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function emptyState(): CatalogRefreshState {
  return { lastAttemptAt: null, lastSuccessAt: null, lastError: null, snapshotId: null };
}

export function readCatalogRefreshState(db: DatabaseSync): CatalogRefreshState {
  const row = db.prepare("SELECT value FROM app_meta WHERE key = ?").get(STATE_KEY) as
    | { value: string }
    | undefined;
  if (!row) return emptyState();
  try {
    const parsed = JSON.parse(row.value) as Partial<CatalogRefreshState>;
    return {
      lastAttemptAt: typeof parsed.lastAttemptAt === "string" ? parsed.lastAttemptAt : null,
      lastSuccessAt: typeof parsed.lastSuccessAt === "string" ? parsed.lastSuccessAt : null,
      lastError: typeof parsed.lastError === "string" ? parsed.lastError : null,
      snapshotId: typeof parsed.snapshotId === "number" ? parsed.snapshotId : null,
    };
  } catch {
    return emptyState();
  }
}

function writeCatalogRefreshState(db: DatabaseSync, state: CatalogRefreshState): void {
  db.prepare(
    `INSERT INTO app_meta (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
  ).run(STATE_KEY, JSON.stringify(state));
}

export interface CatalogRefreshRunner {
  run(): Promise<CatalogRefreshOutcome>;
  runIfDue(): Promise<CatalogRefreshOutcome>;
  state(): CatalogRefreshState;
}

export function createCatalogRefreshRunner(options: {
  db: DatabaseSync;
  refresh: () => Promise<RefreshResult>;
  now?: () => Date;
  maxAgeMs?: number;
}): CatalogRefreshRunner {
  const { db, refresh, now = () => new Date(), maxAgeMs = CATALOG_REFRESH_MAX_AGE_MS } = options;
  let inFlight: Promise<CatalogRefreshOutcome> | null = null;

  function isFresh(): boolean {
    const state = readCatalogRefreshState(db);
    if (!state.lastSuccessAt) return false;
    const elapsed = now().getTime() - Date.parse(state.lastSuccessAt);
    return Number.isFinite(elapsed) && elapsed >= 0 && elapsed < maxAgeMs;
  }

  async function run(): Promise<CatalogRefreshOutcome> {
    if (inFlight) return { ran: false, reason: "in-flight" };

    const attemptAt = now().toISOString();
    const previous = readCatalogRefreshState(db);
    writeCatalogRefreshState(db, { ...previous, lastAttemptAt: attemptAt, lastError: null });

    const attempt = (async (): Promise<CatalogRefreshOutcome> => {
      try {
        const result = await refresh();
        writeCatalogRefreshState(db, {
          lastAttemptAt: attemptAt,
          lastSuccessAt: now().toISOString(),
          lastError: null,
          snapshotId: result.snapshot.id,
        });
        return { ran: true, result };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        writeCatalogRefreshState(db, {
          ...readCatalogRefreshState(db),
          lastAttemptAt: attemptAt,
          lastError: message,
        });
        return { ran: true, error: message };
      } finally {
        inFlight = null;
      }
    })();

    inFlight = attempt;
    return attempt;
  }

  return {
    run,
    async runIfDue() {
      if (inFlight) return { ran: false, reason: "in-flight" };
      if (isFresh()) return { ran: false, reason: "fresh" };
      return run();
    },
    state() {
      return readCatalogRefreshState(db);
    },
  };
}
