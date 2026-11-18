import type { DatabaseSync } from "node:sqlite";
import { readCachedIndex, writeCachedIndex } from "./cache";
import type { DllkidsIndexSnapshot } from "./dllkids";
import type {
  AdoptPinResult,
  PackageDiff,
  PreviousPinMetadata,
  RepoRefWatcher,
  SourcePinEvent,
  SourcePinRecord,
  SourcePinRefresh,
  SourceWatchOverview,
  WatchCheckResult,
} from "./types";
import { observeRepoRef, sha256Hex } from "./observe";
import { diffPackages, isPackageDiff } from "./diff";
import {
  deleteSourcePin,
  hasSourcePinAdoptionHistory,
  inTransaction,
  insertSourcePinEvent,
  listSourcePinEvents,
  patchSourceWatchState,
  readSourcePin,
  readSourceWatchState,
  upsertSourcePin,
} from "./store";

const SOURCE = "dllkids" as const;
export const DEFAULT_SOURCE_WATCH_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface SourceWatchServiceOptions {
  db: DatabaseSync;
  cacheDir: string;
  watcher: RepoRefWatcher<DllkidsIndexSnapshot>;
  /** Config seeds the first pin on a fresh installation only. */
  seedPin?: string | null;
  /** Transactional catalog refresh for one pin. Must throw when activation fails. */
  refresh: SourcePinRefresh;
  intervalMs?: number;
  now?: () => Date;
  adoptedBy?: string;
}

export interface SourceWatchService {
  check(): Promise<WatchCheckResult>;
  adopt(options?: { force?: boolean; adoptedBy?: string }): Promise<AdoptPinResult>;
  rollback(options?: { adoptedBy?: string }): Promise<AdoptPinResult>;
  runIfDue(): Promise<{ ran: boolean; result?: WatchCheckResult }>;
  readOverview(): SourceWatchOverview;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readPrevious(metadata: Record<string, unknown>): PreviousPinMetadata | null {
  const value = metadata.previous;
  if (!value || typeof value !== "object") return null;
  const previous = value as Partial<PreviousPinMetadata>;
  if (typeof previous.value !== "string" || previous.value.length === 0) return null;
  return {
    value: previous.value,
    cachePath: typeof previous.cachePath === "string" ? previous.cachePath : null,
    cacheSha256: typeof previous.cacheSha256 === "string" ? previous.cacheSha256 : null,
    observedAt: typeof previous.observedAt === "string" ? previous.observedAt : null,
    adoptedAt: typeof previous.adoptedAt === "string" ? previous.adoptedAt : null,
    snapshotId: typeof previous.snapshotId === "number" ? previous.snapshotId : null,
    metadata:
      previous.metadata && typeof previous.metadata === "object"
        ? (previous.metadata as Record<string, unknown>)
        : {},
  };
}

function summarizePin(pin: SourcePinRecord): PreviousPinMetadata {
  return {
    value: pin.value,
    cachePath: pin.cachePath,
    cacheSha256: pin.cacheSha256,
    observedAt: pin.observedAt,
    adoptedAt: pin.adoptedAt,
    snapshotId:
      typeof pin.metadata.snapshotId === "number" ? (pin.metadata.snapshotId as number) : null,
    metadata: {
      packageCount: pin.metadata.packageCount,
      diff: pin.metadata.diff,
    },
  };
}

function candidateDiff(record: SourcePinRecord | null): PackageDiff | null {
  if (!record) return null;
  const diff = record.metadata.diff;
  return isPackageDiff(diff) ? diff : null;
}

export function createSourceWatchService(options: SourceWatchServiceOptions): SourceWatchService {
  const {
    db,
    cacheDir,
    watcher,
    refresh,
    intervalMs = DEFAULT_SOURCE_WATCH_INTERVAL_MS,
    now = () => new Date(),
    adoptedBy = "auto",
  } = options;

  function nowIso(): string {
    return now().toISOString();
  }

  function seed(): void {
    if (readSourcePin(db, SOURCE, "active")) return;
    if (!options.seedPin || !/^[0-9a-f]{64}$/.test(options.seedPin)) return;
    upsertSourcePin(db, {
      source: SOURCE,
      status: "active",
      value: options.seedPin,
      metadata: { seededFromConfig: true },
    });
  }

  seed();

  // Serialize observations and adoptions so an admin click and a scheduler
  // tick cannot interleave two catalog refreshes.
  let queue: Promise<unknown> = Promise.resolve();
  function serialize<T>(work: () => Promise<T>): Promise<T> {
    const run = queue.then(work, work);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function baseResult(status: WatchCheckResult["status"]): WatchCheckResult {
    return {
      source: SOURCE,
      status,
      observedPin: null,
      activePin: readSourcePin(db, SOURCE, "active")?.value ?? null,
      snapshotId: null,
      reason: null,
      diff: candidateDiff(readSourcePin(db, SOURCE, "candidate")),
      error: null,
    };
  }

  async function parseActiveBaseline(
    active: SourcePinRecord | null,
  ): Promise<DllkidsIndexSnapshot | null> {
    if (!active?.cachePath) return null;
    const bytes = await readCachedIndex(active.cachePath);
    if (!bytes) return null;
    if (active.cacheSha256 && sha256Hex(bytes) !== active.cacheSha256) return null;
    try {
      return await watcher.parse(bytes);
    } catch {
      return null;
    }
  }

  async function adoptCandidate(input: {
    force: boolean;
    adoptedBy: string;
    /** Distinguishes the one-time fresh-deployment bootstrap from a normal auto-adopt. */
    reason?: "adopted" | "adopted_forced" | "adopted_bootstrap";
  }): Promise<AdoptPinResult> {
    const candidate = readSourcePin(db, SOURCE, "candidate");
    if (!candidate) {
      return { ok: false, source: SOURCE, reason: "no_candidate", blocked: false };
    }

    const blocked = candidate.metadata.blocked === true;
    if (blocked && !input.force) {
      const blockedReason =
        typeof candidate.metadata.blockedReason === "string"
          ? candidate.metadata.blockedReason
          : "same_version_hash_changed";
      return {
        ok: false,
        source: SOURCE,
        reason: blockedReason,
        blocked: true,
      };
    }

    const bytes = candidate.cachePath ? await readCachedIndex(candidate.cachePath) : null;
    if (!bytes) {
      return {
        ok: false,
        source: SOURCE,
        reason: "candidate_cache_missing",
        blocked: false,
        error: "候选索引字节不在缓存中，拒绝在无缓存的情况下采纳",
      };
    }
    const actualSha = sha256Hex(bytes);
    if (actualSha !== candidate.value) {
      return {
        ok: false,
        source: SOURCE,
        reason: "candidate_cache_mismatch",
        blocked: false,
        error: `候选索引缓存 sha256 不一致：期望 ${candidate.value}，实际 ${actualSha}`,
      };
    }

    const previous = readSourcePin(db, SOURCE, "active");
    const adoptedAt = nowIso();
    const metadata: Record<string, unknown> = {
      ...candidate.metadata,
      blocked: false,
      blockedReason: null,
      adoptedFrom: previous?.value ?? null,
      previous: previous ? summarizePin(previous) : null,
    };

    // Step 1: transactionally publish the pin and the cached index path. The
    // catalog refresh follows; if it fails the pin is restored below.
    inTransaction(db, () => {
      upsertSourcePin(db, {
        source: SOURCE,
        status: "active",
        value: candidate.value,
        observedAt: candidate.observedAt,
        adoptedAt,
        adoptedBy: input.adoptedBy,
        cachePath: candidate.cachePath,
        cacheSha256: candidate.cacheSha256,
        metadata,
      });
      deleteSourcePin(db, SOURCE, "candidate");
    });

    try {
      const refreshed = await refresh({
        source: SOURCE,
        pin: candidate.value,
        indexBytes: bytes,
      });

      inTransaction(db, () => {
        const active = readSourcePin(db, SOURCE, "active");
        if (active) {
          upsertSourcePin(db, {
            source: SOURCE,
            status: "active",
            value: active.value,
            observedAt: active.observedAt,
            adoptedAt: active.adoptedAt,
            adoptedBy: active.adoptedBy,
            cachePath: active.cachePath,
            cacheSha256: active.cacheSha256,
            metadata: { ...active.metadata, snapshotId: refreshed.snapshotId },
          });
        }
        insertSourcePinEvent(db, {
          source: SOURCE,
          fromPin: previous?.value ?? null,
          toPin: candidate.value,
          reason: input.reason ?? (input.force ? "adopted_forced" : "adopted"),
          snapshotId: refreshed.snapshotId,
          createdAt: nowIso(),
        });
      });

      patchSourceWatchState(
        db,
        SOURCE,
        { lastError: null, candidateReason: null },
        nowIso(),
      );

      return {
        ok: true,
        source: SOURCE,
        adoptedPin: candidate.value,
        previousPin: previous?.value ?? null,
        snapshotId: refreshed.snapshotId,
        diff: candidateDiff(candidate),
        forced: input.force,
      };
    } catch (error) {
      const failure = messageOf(error);
      // Step 2: refresh failed — restore the previous pin (or no active pin),
      // put the candidate back so the operator can retry, and record why.
      inTransaction(db, () => {
        if (previous) {
          upsertSourcePin(db, {
            source: SOURCE,
            status: "active",
            value: previous.value,
            observedAt: previous.observedAt,
            adoptedAt: previous.adoptedAt,
            adoptedBy: previous.adoptedBy,
            cachePath: previous.cachePath,
            cacheSha256: previous.cacheSha256,
            metadata: previous.metadata,
          });
        } else {
          deleteSourcePin(db, SOURCE, "active");
        }
        upsertSourcePin(db, {
          source: SOURCE,
          status: "candidate",
          value: candidate.value,
          observedAt: candidate.observedAt,
          cachePath: candidate.cachePath,
          cacheSha256: candidate.cacheSha256,
          metadata: candidate.metadata,
        });
        insertSourcePinEvent(db, {
          source: SOURCE,
          fromPin: candidate.value,
          toPin: previous?.value ?? null,
          reason: "adoption_rolled_back",
          snapshotId: null,
          createdAt: nowIso(),
        });
      });

      patchSourceWatchState(
        db,
        SOURCE,
        { lastError: failure, candidateReason: "adoption_failed" },
        nowIso(),
      );

      return {
        ok: false,
        source: SOURCE,
        reason: "refresh_failed",
        blocked: false,
        error: failure,
        rolledBackTo: previous?.value ?? null,
      };
    }
  }

  async function checkInternal(): Promise<WatchCheckResult> {
    const checkAt = nowIso();
    patchSourceWatchState(db, SOURCE, { lastCheckAt: checkAt }, checkAt);

    const activeBefore = readSourcePin(db, SOURCE, "active");
    const observation = await observeRepoRef(watcher);

    if (observation.error || !observation.pin || !observation.parsed) {
      const failure = observation.error ?? "源索引未能完整解析";
      patchSourceWatchState(
        db,
        SOURCE,
        { lastCheckAt: checkAt, lastError: failure, candidateReason: null },
        checkAt,
      );
      return {
        ...baseResult("error"),
        observedPin: observation.pin,
        error: failure,
      };
    }

    if (activeBefore && activeBefore.value === observation.pin) {
      // The pin did not move. If this deployment never cached the active
      // index (config seed, upgrade from V1), cache it now so the next change
      // has a trustworthy baseline for the same-version hash guard.
      if (!activeBefore.cachePath && observation.bytes) {
        try {
          const cached = await writeCachedIndex({
            cacheDir,
            source: SOURCE,
            pin: observation.pin,
            bytes: observation.bytes,
            extension: ".adb",
          });
          upsertSourcePin(db, {
            source: SOURCE,
            status: "active",
            value: activeBefore.value,
            observedAt: observation.observedAt,
            adoptedAt: activeBefore.adoptedAt,
            adoptedBy: activeBefore.adoptedBy,
            cachePath: cached.path,
            cacheSha256: cached.sha256,
            metadata: activeBefore.metadata,
          });
        } catch (error) {
          patchSourceWatchState(
            db,
            SOURCE,
            { lastCheckAt: checkAt, lastError: messageOf(error) },
            checkAt,
          );
          return { ...baseResult("error"), error: messageOf(error) };
        }
      }
      deleteSourcePin(db, SOURCE, "candidate");
      patchSourceWatchState(
        db,
        SOURCE,
        {
          lastCheckAt: checkAt,
          lastSuccessAt: observation.observedAt,
          lastError: null,
          candidateReason: "unchanged",
        },
        checkAt,
      );
      return {
        ...baseResult("unchanged"),
        observedPin: observation.pin,
        activePin: observation.pin,
        diff: null,
      };
    }

    const previousCandidate = readSourcePin(db, SOURCE, "candidate");
    const bytes = observation.bytes;
    if (!bytes) {
      const failure = "源索引没有返回字节，拒绝记录候选";
      patchSourceWatchState(db, SOURCE, { lastError: failure }, checkAt);
      return { ...baseResult("error"), observedPin: observation.pin, error: failure };
    }

    let cached: { path: string; sha256: string };
    try {
      cached = await writeCachedIndex({
        cacheDir,
        source: SOURCE,
        pin: observation.pin,
        bytes,
        extension: ".adb",
      });
    } catch (error) {
      const failure = messageOf(error);
      patchSourceWatchState(db, SOURCE, { lastError: failure }, checkAt);
      return { ...baseResult("error"), observedPin: observation.pin, error: failure };
    }

    const baseline = await parseActiveBaseline(activeBefore);
    // Without the previous index bytes the same-version hash guard cannot run.
    // A fresh deployment has no history at all (the config seed carries only a
    // pin hash), so its *first* observation is allowed to bootstrap-adopt: the
    // seed pin has nothing to compare against and refusing forever would mean
    // automatic adoption never starts. After that one bootstrap, a missing
    // baseline is a real anomaly and blocks until an operator reviews it.
    const baselineMissing = activeBefore !== null && baseline === null;
    const bootstrapEligible =
      baselineMissing && !hasSourcePinAdoptionHistory(db, SOURCE);
    const diff = baseline ? diffPackages(baseline.packages, observation.parsed.packages) : null;
    const sameVersionChange = Boolean(diff && diff.sameVersionHashChanges.length > 0);
    const blocked = (baselineMissing && !bootstrapEligible) || sameVersionChange;
    const blockedReason = sameVersionChange
      ? "same_version_hash_changed"
      : baselineMissing
        ? "baseline_missing"
        : null;

    upsertSourcePin(db, {
      source: SOURCE,
      status: "candidate",
      value: observation.pin,
      observedAt: observation.observedAt,
      cachePath: cached.path,
      cacheSha256: cached.sha256,
      metadata: {
        ref: observation.ref,
        packageCount: observation.parsed.packageCount,
        diff,
        blocked,
        blockedReason,
        ...(bootstrapEligible ? { bootstrap: true } : {}),
      },
    });
    patchSourceWatchState(
      db,
      SOURCE,
      {
        lastCheckAt: checkAt,
        lastSuccessAt: observation.observedAt,
        lastError: null,
        candidateReason: blockedReason ?? "safe_change",
      },
      checkAt,
    );

    if (blocked) {
      if (!previousCandidate || previousCandidate.value !== observation.pin) {
        insertSourcePinEvent(db, {
          source: SOURCE,
          fromPin: activeBefore?.value ?? null,
          toPin: observation.pin,
          reason: baselineMissing ? "blocked_baseline_missing" : "blocked_same_version_hash",
          snapshotId: null,
          createdAt: nowIso(),
        });
      }
      return {
        ...baseResult("blocked"),
        observedPin: observation.pin,
        reason: blockedReason,
        diff,
      };
    }

    const adopted = await adoptCandidate({
      force: false,
      adoptedBy,
      reason: bootstrapEligible ? "adopted_bootstrap" : undefined,
    });
    if (!adopted.ok) {
      return {
        ...baseResult("error"),
        observedPin: observation.pin,
        reason: adopted.reason,
        error: adopted.error ?? adopted.reason,
        diff,
      };
    }
    return {
      ...baseResult("adopted"),
      observedPin: adopted.adoptedPin,
      activePin: adopted.adoptedPin,
      snapshotId: adopted.snapshotId,
      reason: "safe_change",
      diff,
    };
  }

  async function rollbackInternal(input: { adoptedBy: string }): Promise<AdoptPinResult> {
    const active = readSourcePin(db, SOURCE, "active");
    const previous = active ? readPrevious(active.metadata) : null;
    if (!active || !previous) {
      return { ok: false, source: SOURCE, reason: "no_previous_pin", blocked: false };
    }

    const bytes = previous.cachePath ? await readCachedIndex(previous.cachePath) : null;
    if (!bytes) {
      return {
        ok: false,
        source: SOURCE,
        reason: "previous_cache_missing",
        blocked: false,
        error: "上一 pin 的索引字节不在缓存中，无法离线回滚",
      };
    }
    const actualSha = sha256Hex(bytes);
    if (previous.cacheSha256 && actualSha !== previous.cacheSha256) {
      return {
        ok: false,
        source: SOURCE,
        reason: "previous_cache_mismatch",
        blocked: false,
        error: `上一 pin 缓存 sha256 不一致：期望 ${previous.cacheSha256}，实际 ${actualSha}`,
      };
    }

    const current = active;
    const adoptedAt = nowIso();
    const restoredMetadata: Record<string, unknown> = {
      ...previous.metadata,
      blocked: false,
      blockedReason: null,
      adoptedFrom: current.value,
      restoredFrom: current.value,
      previous: summarizePin(current),
    };

    inTransaction(db, () => {
      upsertSourcePin(db, {
        source: SOURCE,
        status: "active",
        value: previous.value,
        observedAt: previous.observedAt,
        adoptedAt,
        adoptedBy: input.adoptedBy,
        cachePath: previous.cachePath,
        cacheSha256: previous.cacheSha256,
        metadata: restoredMetadata,
      });
    });

    try {
      const refreshed = await refresh({
        source: SOURCE,
        pin: previous.value,
        indexBytes: bytes,
      });
      inTransaction(db, () => {
        const restored = readSourcePin(db, SOURCE, "active");
        if (restored) {
          upsertSourcePin(db, {
            source: SOURCE,
            status: "active",
            value: restored.value,
            observedAt: restored.observedAt,
            adoptedAt: restored.adoptedAt,
            adoptedBy: restored.adoptedBy,
            cachePath: restored.cachePath,
            cacheSha256: restored.cacheSha256,
            metadata: { ...restored.metadata, snapshotId: refreshed.snapshotId },
          });
        }
        insertSourcePinEvent(db, {
          source: SOURCE,
          fromPin: current.value,
          toPin: previous.value,
          reason: "rolled_back",
          snapshotId: refreshed.snapshotId,
          createdAt: nowIso(),
        });
      });
      patchSourceWatchState(db, SOURCE, { lastError: null }, nowIso());
      return {
        ok: true,
        source: SOURCE,
        adoptedPin: previous.value,
        previousPin: current.value,
        snapshotId: refreshed.snapshotId,
        diff: null,
        forced: false,
      };
    } catch (error) {
      const failure = messageOf(error);
      inTransaction(db, () => {
        upsertSourcePin(db, {
          source: SOURCE,
          status: "active",
          value: current.value,
          observedAt: current.observedAt,
          adoptedAt: current.adoptedAt,
          adoptedBy: current.adoptedBy,
          cachePath: current.cachePath,
          cacheSha256: current.cacheSha256,
          metadata: current.metadata,
        });
      });
      patchSourceWatchState(db, SOURCE, { lastError: failure }, nowIso());
      return {
        ok: false,
        source: SOURCE,
        reason: "refresh_failed",
        blocked: false,
        error: failure,
        rolledBackTo: current.value,
      };
    }
  }

  return {
    check() {
      return serialize(checkInternal);
    },
    adopt(input = {}) {
      return serialize(() =>
        adoptCandidate({ force: input.force === true, adoptedBy: input.adoptedBy ?? adoptedBy }),
      );
    },
    rollback(input = {}) {
      return serialize(() => rollbackInternal({ adoptedBy: input.adoptedBy ?? adoptedBy }));
    },
    runIfDue() {
      return serialize(async () => {
        const state = readSourceWatchState(db, SOURCE);
        if (state.lastCheckAt) {
          const elapsed = now().getTime() - Date.parse(state.lastCheckAt);
          if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < intervalMs) {
            return { ran: false };
          }
        }
        return { ran: true, result: await checkInternal() };
      });
    },
    readOverview(): SourceWatchOverview {
      const active = readSourcePin(db, SOURCE, "active");
      const candidate = readSourcePin(db, SOURCE, "candidate");
      const previous = active ? readPrevious(active.metadata) : null;
      return {
        source: SOURCE,
        intervalMs,
        active,
        candidate,
        state: readSourceWatchState(db, SOURCE),
        history: listSourcePinEvents(db, SOURCE, 20),
        diff: candidateDiff(candidate),
        rollbackTarget: previous
          ? { value: previous.value, observedAt: previous.observedAt }
          : null,
        note: "dllkids 索引无签名，采纳依赖 sha256 与完整性校验；同版本包哈希变化只告警并阻止自动采纳。",
      };
    },
  };
}

export type { SourcePinEvent };
