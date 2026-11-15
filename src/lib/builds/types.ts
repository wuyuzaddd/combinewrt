import type { BuildConfig, BuildPlan } from "../build/types";
import type { PackageSource } from "../catalog/types";

export type BuildStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type BuildEventSource = "create" | "dispatch" | "poll" | "cancel" | "timeout";

export interface BuildEvent {
  id: number;
  buildId: string;
  fromStatus: BuildStatus | null;
  toStatus: BuildStatus;
  source: BuildEventSource;
  createdAt: string;
}

export const BUILD_STEPS = [
  "prepare-plan",
  "install-tools",
  "download-imagebuilder",
  "download-packages",
  "write-files",
  "build-image",
  "assert-packages",
  "package-artifact",
  "dispatch",
  "timeout",
  "workflow",
] as const;

export type BuildStep = (typeof BUILD_STEPS)[number];

export interface BuildFailure {
  step: BuildStep;
  package: string | null;
  source: PackageSource | null;
  version: string | null;
  message: string;
}

export interface BuildRecord {
  id: string;
  plan: BuildPlan;
  config?: BuildConfig | null;
  status: BuildStatus;
  runId: string | null;
  adapter: "github" | "fake";
  logTail: string;
  error: string | null;
  failure?: BuildFailure | null;
  artifactName: string | null;
  artifactSha256?: string | null;
  artifactSize?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface RunUpdate {
  status: BuildStatus;
  logTail?: string;
  error?: string | null;
  failure?: BuildFailure | null;
  artifactName?: string | null;
  artifactSha256?: string | null;
  artifactSize?: number | null;
}

export interface ArtifactDownload {
  name: string;
  contentType: string;
  size?: number;
  body: Uint8Array | ReadableStream<Uint8Array>;
}

export interface BuildAdapter {
  readonly name: "github" | "fake";
  dispatch(plan: BuildPlan, meta: { buildId: string; artifactName: string }): Promise<{ runId: string | null }>;
  findRun(buildId: string): Promise<string | null>;
  getRun(runId: string, expectedArtifactName?: string): Promise<RunUpdate>;
  cancelRun?(runId: string): Promise<void>;
  downloadArtifact(runId: string, artifactName: string): Promise<ArtifactDownload>;
}
