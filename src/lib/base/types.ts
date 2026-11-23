import type { BaseChannel } from "../domain/types";

export interface BaseVersion {
  version: string;
  releaseDate: string | null;
  imageBuilderUrl: string;
  imageBuilderSha256: string;
  /** release = supported baseline; snapshot = private experimental build. */
  channel: BaseChannel;
  createdAt: string;
}

export interface ReleaseInfo {
  version: string;
  releaseDate: string | null;
}

export interface ReleaseCandidate extends ReleaseInfo {
  imageBuilderUrl: string;
  imageBuilderSha256: string;
}

export interface BaseCheckState {
  checkedAt: string;
  /** The newest upstream release, but only when it is newer than the active baseline. */
  latest: ReleaseCandidate | null;
  error: string | null;
  /**
   * Set when a newly published release was adopted automatically (policy
   * 2026-11-23). The UI shows this as a notice; `error` is filled when the
   * automatic switch could not start.
   */
  autoAdopted?: { version: string; at: string; error: string | null } | null;
}

export type SmokePhase = "refreshing" | "building" | "succeeded" | "failed";

export interface SmokeState {
  phase: SmokePhase;
  buildId: string | null;
  snapshotId: number | null;
  targetVersion: string | null;
  rollbackSnapshotId: number | null;
  error: string | null;
  startedAt: string;
  updatedAt: string;
}

export interface BaseVersionState {
  active: BaseVersion | null;
  previous: BaseVersion | null;
  candidate: ReleaseCandidate | null;
  check: BaseCheckState | null;
  smoke: SmokeState | null;
  supplementBuild: SupplementBuildState | null;
}

export interface SupplementBuildState {
  baseVersion: string;
  triggeredAt: string;
  runId: string | null;
  error: string | null;
}
