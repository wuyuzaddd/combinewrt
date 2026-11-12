export interface BaseVersion {
  version: string;
  releaseDate: string | null;
  imageBuilderUrl: string;
  imageBuilderSha256: string;
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
  latest: ReleaseCandidate | null;
  error: string | null;
}

export type SmokePhase = "refreshing" | "building" | "succeeded" | "failed";

export interface SmokeState {
  phase: SmokePhase;
  buildId: string | null;
  snapshotId: number | null;
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
}
