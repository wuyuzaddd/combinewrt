import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getConfig } from "../config";
import { getDatabase } from "../db";
import { validateBuildForm, validateBuildFormV2 } from "../build/validate";
import { refreshActiveCatalog } from "../catalog/refresh-active";
import { getSourceWatchService } from "../source-watch/scheduler";
import { exportBuildConfig, formStateFromSubmitBody } from "../../app/build/form-model";
import { getBuildService } from ".";
import { createBuildStore } from "./store";
import { openSealedJson } from "../crypto/seal";
import { preparePlanForForm, preparePlanV2ForForm } from "./prepare";
import { onIndexAdopted } from "./retry-signal";
import type { BuildRecord } from "./types";

/**
 * Retry queue for deterministic feed-rotation failures.
 *
 * The dllkids feed publishes a new index and deletes the previous apks in the
 * same step, so a plan pinned to last index 404s at download-packages. Each such
 * submission is retried three times without delay, then once every three hours
 * until a build succeeds. Adopting a new index wakes every waiting entry
 * immediately, because the failure cause is gone at that point.
 */
const RETRIES_PER_WINDOW = 3;
const RETRY_SPACING_MS = 5 * 60 * 1000;
const WINDOW_SPACING_MS = 3 * 60 * 60 * 1000;

interface RetryRow {
  id: string;
  payload_json: string;
  payload_hash: string;
  attempts: number;
  status: string;
  last_build_id: string | null;
}

function failureIsFeedRotation(build: BuildRecord): boolean {
  if (build.status !== "failed") return false;
  const failure = build.failure as { step?: string; message?: string } | null;
  const message = `${failure?.message ?? ""} ${build.error ?? ""}`;
  if (failure?.step === "download-packages") return true;
  return /failed to download|curl: \(22\)|error: 404/i.test(message);
}

function hashPayload(payload: string): string {
  return createHash("sha256").update(payload).digest("hex");
}

export interface BuildRetryRow {
  id: string;
  attempts: number;
  nextAttemptAt: string;
  lastBuildId: string | null;
  lastError: string | null;
  createdAt: string;
}

export interface BuildRetryService {
  observe(build: BuildRecord): void;
  tick(now?: Date): Promise<number>;
  wake(): void;
  pending(): number;
  list(): BuildRetryRow[];
  retryNow(id: string): boolean;
  cancel(id: string): boolean;
}

export function createBuildRetryService(options: { db?: DatabaseSync } = {}): BuildRetryService {
  const db = options.db ?? getDatabase();
  const wakeAll = () => {
    db.prepare(
      `UPDATE build_retries
          SET next_attempt_at = ?, updated_at = ?
        WHERE status = 'waiting' AND next_attempt_at > ?`,
    ).run(new Date().toISOString(), new Date().toISOString(), new Date().toISOString());
  };
  onIndexAdopted(wakeAll);

  /** Re-run a stored submission body exactly like POST /api/builds would. */
  async function redispatch(payloadJson: string): Promise<BuildRecord> {
    const body = openSealedJson(payloadJson);
    // The stored body is the validator's normalised value, so its shape may not
    // satisfy the route's discriminator; probe with the V2 validator directly
    // and fall back to the legacy form.
    const v2 = validateBuildFormV2(body as never);
    if (v2.ok) {
      const validation = v2;
      const prepared = await preparePlanV2ForForm(validation.value);
      if (!prepared.ok) throw new Error("stored build payload no longer prepares a plan");
      if (prepared.conflicts.length > 0) throw new Error(prepared.conflicts.map((c) => c.message).join("; "));
      const storedConfig = exportBuildConfig(
        formStateFromSubmitBody(validation.value as unknown as Record<string, unknown>),
      );
      return getBuildService().submit(prepared.plan, storedConfig);
    }
    const validation = validateBuildForm(body);
    if (!validation.ok) throw new Error(`stored build payload is invalid: ${validation.issues.join("; ")}`);
    const prepared = await preparePlanForForm(validation.value);
    if (!prepared.ok) throw new Error("stored build payload no longer prepares a plan");
    if (prepared.conflicts.length > 0) throw new Error(prepared.conflicts.map((c) => c.message).join("; "));
    return getBuildService().submit(prepared.plan);
  }

  /** Refresh the catalogue first so a retry never re-pins the deleted apk. */
  async function refreshFeeds(): Promise<void> {
    try {
      await getSourceWatchService().check();
    } catch (error) {
      console.warn("[combinewrt] retry: source watch check failed", error);
    }
    try {
      await refreshActiveCatalog({ db, config: getConfig() });
    } catch (error) {
      console.warn("[combinewrt] retry: catalog refresh failed", error);
    }
  }

  return {
    observe(build) {
      const sealed = createBuildStore(db).submitBody(build.id);
      if (!sealed) return;
      const hash = hashPayload(sealed);
      if (build.status === "succeeded") {
        db.prepare(
          `UPDATE build_retries SET status = 'done', updated_at = ?
            WHERE payload_hash = ? AND status = 'waiting' AND last_build_id = ?`,
        ).run(new Date().toISOString(), hash, build.id);
        return;
      }
      if (!failureIsFeedRotation(build)) return;
      const existing = db
        .prepare(`SELECT id FROM build_retries WHERE payload_hash = ? AND status = 'waiting'`)
        .get(hash);
      if (existing) return;
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO build_retries (id, payload_json, payload_hash, status, next_attempt_at, last_build_id, last_error, created_at, updated_at)
         VALUES (?, ?, ?, 'waiting', ?, ?, ?, ?, ?)`,
      ).run(
        randomUUID(),
        sealed,
        hash,
        new Date(Date.now() + RETRY_SPACING_MS).toISOString(),
        build.id,
        build.error ?? null,
        now,
        now,
      );
    },

    async tick(now = new Date()) {
      const due = db
        .prepare(`SELECT id, payload_json, payload_hash, attempts, status FROM build_retries
                   WHERE status = 'waiting' AND next_attempt_at <= ? ORDER BY next_attempt_at LIMIT 5`)
        .all(now.toISOString()) as unknown as RetryRow[];
      let dispatched = 0;
      for (const row of due) {
        // Never stack retries on top of a build that is still in flight: the
        // previous attempt only counts as failed once its status is terminal.
        const last = row.last_build_id
          ? getBuildService().get(row.last_build_id)
          : null;
        const terminal = last && (last.status === "succeeded" || last.status === "failed" || last.status === "cancelled");
        if (last && !terminal) {
          db.prepare(`UPDATE build_retries SET next_attempt_at = ?, updated_at = ? WHERE id = ?`).run(
            new Date(now.getTime() + RETRY_SPACING_MS).toISOString(),
            now.toISOString(),
            row.id,
          );
          continue;
        }
        await refreshFeeds();
        try {
          const build = await redispatch(row.payload_json);
          const attempts = row.attempts + 1;
          const exhausted = attempts >= RETRIES_PER_WINDOW;
          const next = new Date(now.getTime() + (exhausted ? WINDOW_SPACING_MS : RETRY_SPACING_MS));
          db.prepare(
            `UPDATE build_retries
                SET attempts = ?, next_attempt_at = ?, last_build_id = ?, last_error = NULL, updated_at = ?
              WHERE id = ?`,
          ).run(
            exhausted ? 0 : attempts,
            next.toISOString(),
            build.id,
            new Date().toISOString(),
            row.id,
          );
          dispatched += 1;
          console.info(`[combinewrt] retried build ${build.id} (window attempt ${exhausted ? RETRIES_PER_WINDOW : attempts})`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const attempts = row.attempts + 1;
          const exhausted = attempts >= RETRIES_PER_WINDOW;
          const next = new Date(now.getTime() + (exhausted ? WINDOW_SPACING_MS : RETRY_SPACING_MS));
          db.prepare(
            `UPDATE build_retries SET attempts = ?, next_attempt_at = ?, last_error = ?, updated_at = ? WHERE id = ?`,
          ).run(exhausted ? 0 : attempts, next.toISOString(), message, new Date().toISOString(), row.id);
          console.warn("[combinewrt] retry dispatch failed", message);
        }
      }
      return dispatched;
    },

    wake() {
      wakeAll();
    },

    pending() {
      const row = db.prepare(`SELECT COUNT(*) AS n FROM build_retries WHERE status = 'waiting'`).get() as { n: number };
      return row.n;
    },

    list() {
      const rows = db
        .prepare(
          `SELECT id, attempts, next_attempt_at, last_build_id, last_error, created_at
             FROM build_retries WHERE status = 'waiting' ORDER BY next_attempt_at LIMIT 50`,
        )
        .all() as unknown as Array<{
        id: string;
        attempts: number;
        next_attempt_at: string;
        last_build_id: string | null;
        last_error: string | null;
        created_at: string;
      }>;
      return rows.map((row) => ({
        id: row.id,
        attempts: row.attempts,
        nextAttemptAt: row.next_attempt_at,
        lastBuildId: row.last_build_id,
        lastError: row.last_error,
        createdAt: row.created_at,
      }));
    },

    retryNow(id) {
      const info = db
        .prepare(`UPDATE build_retries SET next_attempt_at = ?, updated_at = ? WHERE id = ? AND status = 'waiting'`)
        .run(new Date().toISOString(), new Date().toISOString(), id);
      return Number(info.changes) > 0;
    },

    cancel(id) {
      const info = db
        .prepare(`UPDATE build_retries SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'waiting'`)
        .run(new Date().toISOString(), id);
      return Number(info.changes) > 0;
    },
  };
}
