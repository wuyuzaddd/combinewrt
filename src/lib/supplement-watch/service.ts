import type { DatabaseSync } from "node:sqlite";
import { inTransaction, deleteSourcePin, insertSourcePinEvent, listSourcePinEvents, patchSourceWatchState, readSourcePin, readSourceWatchState, upsertSourcePin } from "../source-watch/store";
import {
  decidePublishGate,
  fingerprintRecipe,
  type PublishGateReason,
  type PublishMode,
  type RecipeFingerprint,
  type SupplementRecipe,
} from "./recipe";
import {
  insertOrReadSupplementPublish,
  insertSupplementPublishEvent,
  listSupplementPublishes,
  listSupplementPublishEvents,
  listUnresolvedPublishes,
  readSupplementPublish,
  readSupplementPublishByCommit,
  updateSupplementPublish,
} from "./store";
import type {
  FeedPublishRecord,
  SupplementPinMetadata,
  SupplementPublishEvent,
  SupplementPublishRecord,
  SupplementPublishStatus,
  SupplementPublishTrigger,
} from "./types";

const SOURCE = "supplement" as const;
export const DEFAULT_SUPPLEMENT_WATCH_INTERVAL_MS = 6 * 60 * 60 * 1000;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const MAX_RECONCILE_ATTEMPTS = 6;

export interface BuildRunState {
  status: "queued" | "in_progress" | "completed" | "unknown";
  conclusion: string | null;
  url: string | null;
}

export interface SupplementWatchServiceOptions {
  db: DatabaseSync;
  sourceRepo: string;
  sourceRef: string;
  baseVersion: string;
  target: string;
  buildRepo: string;
  buildWorkflow: string;
  keyFingerprint: string;
  /** Absolute URL of the feed repo publish audit record (live channel). */
  publishAuditUrl: string;
  /** Absolute URL of the feed repo staging audit record. */
  stagingAuditUrl?: string;
  intervalMs?: number;
  now?: () => Date;
  /** Current recipe; null means the recipe is not configured yet. */
  readRecipe: () => SupplementRecipe | null;
  /** HEAD commit of the upstream source branch. */
  observeUpstream: () => Promise<{ commit: string; observedAt: string }>;
  /** Trigger the supplement build workflow. */
  dispatchBuild: (input: DispatchBuildInput) => Promise<{ runId: string; url: string | null }>;
  /** Read a build run's state; throwing is treated as a transient failure. */
  readRun: (runId: string) => Promise<BuildRunState>;
  /** Ask the feed repo to promote a staged build run to the live channel. */
  dispatchPublish?: (input: { buildRunId: string; baseVersion: string; sourceCommit: string }) => Promise<void>;
  /** Fetch and parse a feed audit record. */
  fetchFeedRecord?: (url: string) => Promise<unknown>;
  /** Transactional catalog refresh after a live publish adopts the new pin. */
  refresh?: (input: { commit: string; baseVersion: string }) => Promise<{ snapshotId: number }>;
  adoptedBy?: string;
}

export interface DispatchBuildInput {
  baseVersion: string;
  sourceCommit: string;
  publishMode: PublishMode;
  gateReason: PublishGateReason;
  recipe: RecipeFingerprint;
}

export type SupplementCheckStatus = "dispatched" | "skipped" | "error";

export interface SupplementCheckResult {
  source: typeof SOURCE;
  status: SupplementCheckStatus;
  observedCommit: string | null;
  activeCommit: string | null;
  publishId: number | null;
  buildRunId: string | null;
  publishMode: PublishMode | null;
  gateReason: PublishGateReason | null;
  reason: string;
  error: string | null;
}

export interface ReconcileResult {
  checked: number;
  updated: SupplementPublishStatus[];
  error: string | null;
}

export interface PromoteResult {
  ok: boolean;
  blocked?: boolean;
  reason: string;
  record: SupplementPublishRecord | null;
}

export interface SupplementOverview {
  source: typeof SOURCE;
  baseVersion: string;
  target: string;
  sourceRepo: string;
  sourceRef: string;
  intervalMs: number;
  active: (SupplementPinMetadata & { commit: string; adoptedAt: string | null; adoptedBy: string | null }) | null;
  candidate: (SupplementPinMetadata & { commit: string; observedAt: string | null }) | null;
  state: ReturnType<typeof readSourceWatchState>;
  recipe: { recipeHash: string; spdx: string; publicAllowed: boolean; packageSetShape: string[] } | null;
  publishes: SupplementPublishRecord[];
  events: SupplementPublishEvent[];
}

export interface SupplementWatchService {
  check(options?: { trigger?: SupplementPublishTrigger; observedCommit?: string }): Promise<SupplementCheckResult>;
  reconcile(options?: { limit?: number }): Promise<ReconcileResult>;
  promote(publishId: number, options?: { promotedBy?: string }): Promise<PromoteResult>;
  runIfDue(): Promise<{ ran: boolean; result?: SupplementCheckResult }>;
  readOverview(): SupplementOverview;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isFingerprint(value: unknown): value is RecipeFingerprint {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<RecipeFingerprint>;
  return (
    typeof record.recipeHash === "string" &&
    typeof record.spdx === "string" &&
    typeof record.publicAllowed === "boolean" &&
    Array.isArray(record.packageSetShape) &&
    typeof record.fingerprint === "string"
  );
}

/** Rebuild the gate baseline from the active pin's stored metadata. */
export function fingerprintFromPinMetadata(metadata: Record<string, unknown>): RecipeFingerprint | null {
  const candidate = {
    recipeHash: metadata.recipeHash,
    spdx: metadata.spdx,
    publicAllowed: metadata.publicAllowed,
    packageSetShape: metadata.packageSetShape,
    fingerprint: metadata.metadataFingerprint,
  };
  return isFingerprint(candidate) ? candidate : null;
}

/** Validate one audit record written by the feed repo's publish pipeline. */
export function parseFeedRecord(value: unknown): FeedPublishRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.channel !== "live" && record.channel !== "staging") return null;
  const required = ["buildRunId", "baseVersion", "target", "sourceCommit", "indexSha256", "keyFingerprint", "frozenPath", "publishedAt"] as const;
  for (const field of required) {
    if (typeof record[field] !== "string" || (record[field] as string).length === 0) return null;
  }
  return record as unknown as FeedPublishRecord;
}

export function createSupplementWatchService(options: SupplementWatchServiceOptions): SupplementWatchService {
  const {
    db,
    baseVersion,
    target,
    sourceRepo,
    sourceRef,
    keyFingerprint,
    publishAuditUrl,
    stagingAuditUrl,
    intervalMs = DEFAULT_SUPPLEMENT_WATCH_INTERVAL_MS,
    now = () => new Date(),
    readRecipe,
    observeUpstream,
    dispatchBuild,
    readRun,
    dispatchPublish,
    fetchFeedRecord,
    refresh,
    adoptedBy = "auto-publish",
  } = options;

  let queue: Promise<unknown> = Promise.resolve();
  function serialize<T>(work: () => Promise<T>): Promise<T> {
    const run = queue.then(work, work);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function iso(): string {
    return now().toISOString();
  }

  function baseResult(status: SupplementCheckStatus): SupplementCheckResult {
    return {
      source: SOURCE,
      status,
      observedCommit: null,
      activeCommit: readSourcePin(db, SOURCE, "active")?.value ?? null,
      publishId: null,
      buildRunId: null,
      publishMode: null,
      gateReason: null,
      reason: "",
      error: null,
    };
  }

  function recordEvent(
    publishId: number,
    fromStatus: SupplementPublishStatus | null,
    toStatus: SupplementPublishStatus,
    reason: string | null,
    detail: Record<string, unknown> = {},
  ): void {
    insertSupplementPublishEvent(db, { publishId, fromStatus, toStatus, reason, detail, now: iso() });
  }

  async function readFeedRecord(url: string | undefined): Promise<FeedPublishRecord | null> {
    if (!url || !fetchFeedRecord) return null;
    try {
      const parsed = parseFeedRecord(await fetchFeedRecord(url));
      return parsed;
    } catch {
      return null;
    }
  }

  /** Adopt the newly published commit as the active source pin. */
  async function adoptPublished(record: SupplementPublishRecord, feed: FeedPublishRecord): Promise<void> {
    const publishedAt = iso();
    const previous = readSourcePin(db, SOURCE, "active");
    const metadata: SupplementPinMetadata = {
      baseVersion: record.baseVersion,
      target: record.target,
      recipeHash: record.recipeHash,
      spdx: record.spdx,
      publicAllowed: record.publicAllowed,
      packageSetShape: record.packageSetShape,
      metadataFingerprint: record.metadataFingerprint,
      buildRunId: record.buildRunId,
      indexSha256: feed.indexSha256,
      keyFingerprint: feed.keyFingerprint,
      frozenPath: feed.frozenPath,
      publishedAt: feed.publishedAt,
    };

    inTransaction(db, () => {
      upsertSourcePin(db, {
        source: SOURCE,
        status: "active",
        value: record.sourceCommit,
        observedAt: record.createdAt,
        adoptedAt: publishedAt,
        adoptedBy,
        cachePath: null,
        cacheSha256: null,
        metadata: metadata as Record<string, unknown>,
      });
      deleteSourcePin(db, SOURCE, "candidate");
      insertSourcePinEvent(db, {
        source: SOURCE,
        fromPin: previous?.value ?? null,
        toPin: record.sourceCommit,
        reason: "supplement_auto_published",
        snapshotId: null,
        createdAt: publishedAt,
      });
    });

    updateSupplementPublish(
      db,
      record.id,
      {
        status: "published",
        indexSha256: feed.indexSha256,
        keyFingerprint: feed.keyFingerprint,
        frozenPath: feed.frozenPath,
        reason: "metadata_unchanged",
      },
      publishedAt,
    );
    recordEvent(record.id, record.status, "published", "live", {
      indexSha256: feed.indexSha256,
      frozenPath: feed.frozenPath,
    });

    if (refresh) {
      try {
        const refreshed = await refresh({ commit: record.sourceCommit, baseVersion: record.baseVersion });
        patchSourceWatchState(db, SOURCE, { lastError: null }, iso());
        recordEvent(record.id, "published", "published", "catalog_refreshed", {
          snapshotId: refreshed.snapshotId,
        });
      } catch (error) {
        patchSourceWatchState(db, SOURCE, { lastError: `catalog refresh failed: ${messageOf(error)}` }, iso());
      }
    }
  }

  async function checkInternal(input: {
    trigger: SupplementPublishTrigger;
    observedCommit?: string;
  }): Promise<SupplementCheckResult> {
    const base = baseResult("error");
    const checkAt = iso();
    patchSourceWatchState(db, SOURCE, { lastCheckAt: checkAt }, checkAt);

    const recipe = readRecipe();
    if (!recipe) {
      patchSourceWatchState(db, SOURCE, { lastError: "supplement recipe is not configured" }, checkAt);
      return { ...base, status: "error", error: "supplement recipe is not configured" };
    }
    const fingerprint = fingerprintRecipe(recipe);

    let commit = input.observedCommit?.trim().toLowerCase() ?? "";
    if (commit === "") {
      try {
        const observed = await observeUpstream();
        commit = observed.commit.trim().toLowerCase();
      } catch (error) {
        const failure = `upstream observation failed: ${messageOf(error)}`;
        patchSourceWatchState(db, SOURCE, { lastError: failure }, checkAt);
        return { ...base, status: "error", error: failure };
      }
    }
    if (!COMMIT_PATTERN.test(commit)) {
      const failure = `source commit ${JSON.stringify(commit)} is not a 40 character lowercase git commit`;
      patchSourceWatchState(db, SOURCE, { lastError: failure }, checkAt);
      return { ...base, status: "error", error: failure };
    }

    const metadata: SupplementPinMetadata = {
      baseVersion: recipe.baseVersion,
      target: recipe.target,
      recipeHash: fingerprint.recipeHash,
      spdx: fingerprint.spdx,
      publicAllowed: fingerprint.publicAllowed,
      packageSetShape: fingerprint.packageSetShape,
      metadataFingerprint: fingerprint.fingerprint,
    };
    upsertSourcePin(db, {
      source: SOURCE,
      status: "candidate",
      value: commit,
      observedAt: checkAt,
      metadata: metadata as Record<string, unknown>,
    });

    const existing = readSupplementPublishByCommit(db, recipe.baseVersion, commit);
    if (existing && existing.status !== "failed") {
      patchSourceWatchState(
        db,
        SOURCE,
        { lastSuccessAt: checkAt, lastError: null, candidateReason: "supplement_skipped" },
        checkAt,
      );
      return {
        ...base,
        status: "skipped",
        observedCommit: commit,
        publishId: existing.id,
        buildRunId: existing.buildRunId,
        publishMode: existing.publishMode,
        gateReason: existing.gateReason,
        reason: `already_${existing.status}`,
      };
    }

    const activePin = readSourcePin(db, SOURCE, "active");
    const activeFingerprint = activePin ? fingerprintFromPinMetadata(activePin.metadata) : null;
    const decision = decidePublishGate({ active: activeFingerprint, candidate: fingerprint });

    let dispatch: { runId: string; url: string | null };
    try {
      dispatch = await dispatchBuild({
        baseVersion: recipe.baseVersion,
        sourceCommit: commit,
        publishMode: decision.publishMode,
        gateReason: decision.reason,
        recipe: fingerprint,
      });
    } catch (error) {
      const failure = `supplement build dispatch failed: ${messageOf(error)}`;
      const { record } = insertOrReadSupplementPublish(db, {
        baseVersion: recipe.baseVersion,
        target: recipe.target,
        sourceCommit: commit,
        recipeHash: fingerprint.recipeHash,
        spdx: fingerprint.spdx,
        publicAllowed: fingerprint.publicAllowed,
        packageSetShape: fingerprint.packageSetShape,
        metadataFingerprint: fingerprint.fingerprint,
        publishMode: decision.publishMode,
        gateReason: decision.reason,
        trigger: input.trigger,
        status: "failed",
        reason: "dispatch_failed",
        now: checkAt,
      });
      if (record.status !== "failed") {
        updateSupplementPublish(db, record.id, { status: "failed", reason: "dispatch_failed" }, checkAt);
      }
      recordEvent(record.id, null, "failed", "dispatch_failed", { error: failure });
      patchSourceWatchState(db, SOURCE, { lastError: failure, candidateReason: "supplement_dispatch_failed" }, checkAt);
      return { ...base, status: "error", observedCommit: commit, publishId: record.id, error: failure };
    }

    const { record, created } = insertOrReadSupplementPublish(db, {
      baseVersion: recipe.baseVersion,
      target: recipe.target,
      sourceCommit: commit,
      recipeHash: fingerprint.recipeHash,
      spdx: fingerprint.spdx,
      publicAllowed: fingerprint.publicAllowed,
      packageSetShape: fingerprint.packageSetShape,
      metadataFingerprint: fingerprint.fingerprint,
      publishMode: decision.publishMode,
      gateReason: decision.reason,
      trigger: input.trigger,
      status: "dispatched",
      buildRunId: dispatch.runId,
      buildRunUrl: dispatch.url,
      now: checkAt,
    });

    // A retry of a previously failed attempt reuses the row: clear the failure,
    // bump the attempt counter and keep a single dispatch record per commit.
    const updated =
      created
        ? record
        : updateSupplementPublish(
            db,
            record.id,
            {
              status: "dispatched",
              publishMode: decision.publishMode,
              gateReason: decision.reason,
              trigger: input.trigger,
              buildRunId: dispatch.runId,
              buildRunUrl: dispatch.url,
              reason: "retry",
              attempts: record.attempts + 1,
            },
            checkAt,
          );
    recordEvent(
      updated.id,
      created ? null : "failed",
      "dispatched",
      decision.reason,
      {
        publishMode: decision.publishMode,
        changed: decision.changed,
        buildRunId: dispatch.runId,
        trigger: input.trigger,
      },
    );
    patchSourceWatchState(
      db,
      SOURCE,
      {
        lastSuccessAt: checkAt,
        lastError: null,
        candidateReason: decision.publishMode === "live" ? "supplement_live_dispatched" : "supplement_staging_dispatched",
      },
      checkAt,
    );

    return {
      source: SOURCE,
      status: "dispatched",
      observedCommit: commit,
      activeCommit: activePin?.value ?? null,
      publishId: updated.id,
      buildRunId: dispatch.runId,
      publishMode: decision.publishMode,
      gateReason: decision.reason,
      reason: decision.reason,
      error: null,
    };
  }

  async function reconcileInternal(limit = 10): Promise<ReconcileResult> {
    const rows = listUnresolvedPublishes(db, limit);
    const updated: SupplementPublishStatus[] = [];
    let error: string | null = null;

    for (const row of rows) {
      if (!row.buildRunId) {
        updateSupplementPublish(db, row.id, { status: "failed", reason: "missing_run_id" }, iso());
        updated.push("failed");
        continue;
      }
      let run: BuildRunState;
      try {
        run = await readRun(row.buildRunId);
      } catch (caught) {
        error = messageOf(caught);
        const attempts = row.attempts + 1;
        if (attempts >= MAX_RECONCILE_ATTEMPTS) {
          updateSupplementPublish(db, row.id, { status: "failed", reason: "run_lookup_failed", attempts }, iso());
          updated.push("failed");
        } else {
          updateSupplementPublish(db, row.id, { attempts }, iso());
        }
        continue;
      }

      if (run.status !== "completed") {
        if (row.status === "dispatched") {
          updateSupplementPublish(db, row.id, { status: "running" }, iso());
          recordEvent(row.id, "dispatched", "running", null, { runStatus: run.status });
        }
        continue;
      }

      if (run.conclusion !== "success") {
        updateSupplementPublish(
          db,
          row.id,
          { status: "failed", reason: `build_${run.conclusion ?? "unknown"}` },
          iso(),
        );
        recordEvent(row.id, row.status, "failed", `build_${run.conclusion ?? "unknown"}`, {
          conclusion: run.conclusion,
        });
        patchSourceWatchState(db, SOURCE, { lastError: `build run ${row.buildRunId} ${run.conclusion ?? "failed"}` }, iso());
        updated.push("failed");
        continue;
      }

      const live = await readFeedRecord(publishAuditUrl);
      if (live && live.buildRunId === row.buildRunId && live.channel === "live") {
        if (live.keyFingerprint !== keyFingerprint) {
          // A live audit record signed by an unexpected key must never become
          // the active pin: the project key fingerprint is the trust anchor.
          updateSupplementPublish(db, row.id, { status: "failed", reason: "key_fingerprint_mismatch" }, iso());
          recordEvent(row.id, row.status, "failed", "key_fingerprint_mismatch", {
            expected: keyFingerprint,
            actual: live.keyFingerprint,
          });
          patchSourceWatchState(db, SOURCE, { lastError: "feed audit key fingerprint mismatch" }, iso());
          updated.push("failed");
          continue;
        }
        await adoptPublished(row, live);
        updated.push("published");
        continue;
      }

      const staging = await readFeedRecord(stagingAuditUrl);
      if (staging && staging.buildRunId === row.buildRunId && staging.channel === "staging") {
        updateSupplementPublish(
          db,
          row.id,
          {
            status: "staged",
            reason: row.gateReason === "metadata_unchanged" ? "staged" : row.gateReason,
            indexSha256: staging.indexSha256,
            keyFingerprint: staging.keyFingerprint,
            frozenPath: staging.frozenPath,
          },
          iso(),
        );
        recordEvent(row.id, row.status, "staged", row.gateReason, {
          indexSha256: staging.indexSha256,
          frozenPath: staging.frozenPath,
        });
        patchSourceWatchState(
          db,
          SOURCE,
          { lastError: null, candidateReason: "supplement_staged" },
          iso(),
        );
        updated.push("staged");
        continue;
      }

      // Build finished but the feed repo has not published (yet). Keep polling
      // a bounded number of times so a stuck publish surfaces as publish_pending
      // instead of a silent queued row.
      // `attempts` counts the dispatch itself, so the poll budget is one more
      // than the number of reconciliations we allow after it.
      const attempts = row.attempts + 1;
      const exhausted = attempts > MAX_RECONCILE_ATTEMPTS;
      updateSupplementPublish(
        db,
        row.id,
        {
          status: exhausted ? "publish_pending" : "running",
          reason: "publish_audit_pending",
          attempts,
        },
        iso(),
      );
      recordEvent(row.id, row.status, exhausted ? "publish_pending" : "running", "publish_audit_pending", {
        attempts,
      });
      updated.push(exhausted ? "publish_pending" : "running");
    }

    return { checked: rows.length, updated, error };
  }

  return {
    check(input = {}) {
      return serialize(() =>
        checkInternal({ trigger: input.trigger ?? "manual", observedCommit: input.observedCommit }).catch(
          (error): SupplementCheckResult => {
            const failure = messageOf(error);
            patchSourceWatchState(db, SOURCE, { lastError: failure }, iso());
            return { ...baseResult("error"), error: failure };
          },
        ),
      );
    },

    reconcile(input = {}) {
      return serialize(() => reconcileInternal(input.limit ?? 10)).catch(
        (error): ReconcileResult => ({ checked: 0, updated: [], error: messageOf(error) }),
      );
    },

    promote(publishId, input = {}) {
      return serialize(async (): Promise<PromoteResult> => {
        const row = readSupplementPublish(db, publishId);
        if (!row) return { ok: false, blocked: true, reason: "publish_not_found", record: null };
        if (row.status !== "staged") {
          return { ok: false, blocked: true, reason: `publish_is_${row.status}`, record: row };
        }
        if (!row.buildRunId) {
          return { ok: false, blocked: true, reason: "missing_run_id", record: row };
        }
        if (!dispatchPublish) {
          return { ok: false, blocked: true, reason: "promotion_not_configured", record: row };
        }
        try {
          await dispatchPublish({
            buildRunId: row.buildRunId,
            baseVersion: row.baseVersion,
            sourceCommit: row.sourceCommit,
          });
        } catch (error) {
          const failure = `promotion dispatch failed: ${messageOf(error)}`;
          patchSourceWatchState(db, SOURCE, { lastError: failure }, iso());
          return { ok: false, reason: failure, record: row };
        }
        const promoted = updateSupplementPublish(
          db,
          row.id,
          {
            publishMode: "live",
            status: "dispatched",
            reason: "promoted_from_staging",
            promotedAt: iso(),
            promotedBy: input.promotedBy ?? "operator",
            attempts: row.attempts + 1,
          },
          iso(),
        );
        recordEvent(row.id, "staged", "dispatched", "promoted_from_staging", {
          promotedBy: input.promotedBy ?? "operator",
        });
        return { ok: true, reason: "promoted_from_staging", record: promoted };
      });
    },

    runIfDue() {
      return serialize(async () => {
        const state = readSourceWatchState(db, SOURCE);
        const last = state?.lastCheckAt ? Date.parse(state.lastCheckAt) : Number.NaN;
        const due = !Number.isFinite(last) || now().getTime() - last >= intervalMs;
        if (!due) return { ran: false };
        return { ran: true, result: await checkInternal({ trigger: "schedule" }) };
      }).catch((error) => ({ ran: false, result: { ...baseResult("error"), error: messageOf(error) } }));
    },

    readOverview(): SupplementOverview {
      const activePin = readSourcePin(db, SOURCE, "active");
      const candidatePin = readSourcePin(db, SOURCE, "candidate");
      const publishes = listSupplementPublishes(db, { baseVersion, target, limit: 10 });
      const recipe = readRecipe();
      return {
        source: SOURCE,
        baseVersion,
        target,
        sourceRepo,
        sourceRef,
        intervalMs,
        active: activePin
          ? {
              ...(activePin.metadata as SupplementPinMetadata),
              commit: activePin.value,
              adoptedAt: activePin.adoptedAt,
              adoptedBy: activePin.adoptedBy,
            }
          : null,
        candidate: candidatePin
          ? {
              ...(candidatePin.metadata as SupplementPinMetadata),
              commit: candidatePin.value,
              observedAt: candidatePin.observedAt,
            }
          : null,
        state: readSourceWatchState(db, SOURCE),
        recipe: recipe
          ? {
              ...fingerprintRecipe(recipe),
            }
          : null,
        publishes,
        events: publishes[0] ? listSupplementPublishEvents(db, publishes[0].id, 10) : [],
      };
    },
  };
}

export type { RecipeFingerprint, SupplementRecipe };
export { listSourcePinEvents };
