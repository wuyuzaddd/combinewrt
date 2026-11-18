/**
 * Vocabulary for V2 source pins and the source watch (ADR 0008).
 *
 * A "source pin" is an immutable identity for one upstream source: a sha256 for
 * an index file (dllkids) or a git commit for a repository ref (supplement,
 * extension). Pins live in the database; config only seeds the first dllkids
 * pin on a fresh installation.
 */

export const WATCH_SOURCES = ["dllkids", "supplement", "extension"] as const;
export type WatchSourceId = (typeof WATCH_SOURCES)[number];

export type PinStatus = "active" | "candidate";

export type PinEventReason =
  | "adopted"
  | "adopted_forced"
  | "adopted_bootstrap"
  | "blocked_same_version_hash"
  | "blocked_baseline_missing"
  | "adoption_rolled_back"
  | "rolled_back"
  | "supplement_auto_published";

export interface SourcePinRecord {
  id: number;
  source: WatchSourceId;
  status: PinStatus;
  /** sha256 of an index file, or a git commit id. */
  value: string;
  observedAt: string | null;
  adoptedAt: string | null;
  adoptedBy: string | null;
  cachePath: string | null;
  cacheSha256: string | null;
  metadata: Record<string, unknown>;
}

export interface SourcePinEvent {
  id: number;
  source: WatchSourceId;
  fromPin: string | null;
  toPin: string | null;
  reason: PinEventReason;
  snapshotId: number | null;
  createdAt: string;
}

export type WatchCandidateReason =
  | "safe_change"
  | "same_version_hash_changed"
  | "baseline_missing"
  | "adoption_failed"
  | "unchanged"
  | "supplement_live_dispatched"
  | "supplement_staging_dispatched"
  | "supplement_staged"
  | "supplement_dispatch_failed"
  | "supplement_skipped";

export interface SourceWatchState {
  source: WatchSourceId;
  lastCheckAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  candidateReason: WatchCandidateReason | null;
  updatedAt: string | null;
}

/** Package identity used for diffs. The sha256 is null when the feed omitted it. */
export interface PackageFingerprint {
  name: string;
  version: string;
  sha256: string | null;
}

export interface SameVersionHashChange {
  name: string;
  version: string;
  from: string;
  to: string;
}

export interface PackageDiff {
  activeCount: number;
  candidateCount: number;
  added: string[];
  removed: string[];
  upgraded: Array<{ name: string; from: string; to: string }>;
  downgraded: Array<{ name: string; from: string; to: string }>;
  /**
   * A package whose version did not change but whose artifact hash did. This is
   * the anomaly that blocks automatic adoption: it can indicate a rebuild
   * behind the same version, a compromised upstream, or a truncated index.
   */
  sameVersionHashChanges: SameVersionHashChange[];
}

/**
 * One observation of a repository ref. This is the reusable seam tickets 11
 * (supplement) and 12 (extension) call: fetch bytes, identify the ref, parse
 * fully, and never throw for an upstream failure.
 */
export interface RepoRefObservation<T> {
  source: WatchSourceId;
  ref: string;
  observedAt: string;
  pin: string | null;
  bytes: Buffer | null;
  parsed: T | null;
  error: string | null;
}

export interface RepoRefWatcher<T> {
  readonly source: WatchSourceId;
  readonly ref: string;
  /** Observe the ref once; resolves with an error observation instead of throwing. */
  observe(): Promise<RepoRefObservation<T>>;
  /** Parse already-downloaded index bytes (cached baseline, rollback). */
  parse(bytes: Buffer): Promise<T>;
}

export interface SourcePinRefreshInput {
  source: WatchSourceId;
  pin: string;
  indexBytes: Buffer;
}

export interface SourcePinRefreshResult {
  snapshotId: number;
}

export type SourcePinRefresh = (input: SourcePinRefreshInput) => Promise<SourcePinRefreshResult>;

/** Shape stored under metadata.previous so rollback can restore the prior pin. */
export interface PreviousPinMetadata {
  value: string;
  cachePath: string | null;
  cacheSha256: string | null;
  observedAt: string | null;
  adoptedAt: string | null;
  snapshotId: number | null;
  metadata: Record<string, unknown>;
}

export interface AdoptedPinResult {
  ok: true;
  source: WatchSourceId;
  adoptedPin: string;
  previousPin: string | null;
  snapshotId: number;
  diff: PackageDiff | null;
  forced: boolean;
}

export interface RejectedPinResult {
  ok: false;
  source: WatchSourceId;
  reason: string;
  blocked: boolean;
  error?: string;
  rolledBackTo?: string | null;
}

export type AdoptPinResult = AdoptedPinResult | RejectedPinResult;

export type WatchCheckStatus = "adopted" | "unchanged" | "blocked" | "error";

export interface WatchCheckResult {
  source: WatchSourceId;
  status: WatchCheckStatus;
  observedPin: string | null;
  activePin: string | null;
  snapshotId: number | null;
  reason: string | null;
  diff: PackageDiff | null;
  error: string | null;
}

export interface SourceWatchOverview {
  source: WatchSourceId;
  intervalMs: number;
  active: SourcePinRecord | null;
  candidate: SourcePinRecord | null;
  state: SourceWatchState;
  history: SourcePinEvent[];
  diff: PackageDiff | null;
  rollbackTarget: { value: string; observedAt: string | null } | null;
  note: string;
}
