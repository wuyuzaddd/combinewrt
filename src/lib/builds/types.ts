import type { BuildConfig, BuildConfigV2, BuildPlan } from "../build/types";
import type { PackageSource } from "../catalog/types";
import type { BuildEngine } from "../domain/types";

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
  "postprocess",
  "package-artifact",
  "dispatch",
  "timeout",
  "workflow",
] as const;

export type BuildStep = (typeof BUILD_STEPS)[number];

/**
 * V2 plan context the workflow attaches to a failure marker so the UI can say
 * which target, variant and engine failed without re-reading the plan.
 */
export interface BuildFailureContext {
  target?: string;
  variant?: string;
  engine?: BuildEngine;
}

export interface BuildFailure {
  step: BuildStep;
  package: string | null;
  source: PackageSource | null;
  version: string | null;
  message: string;
  context?: BuildFailureContext;
}

export interface BuildRecord {
  id: string;
  plan: BuildPlan;
  /** V1 rows keep `imageType`; V2 rows store the variant-only config. */
  config?: BuildConfig | BuildConfigV2 | null;
  status: BuildStatus;
  runId: string | null;
  adapter: "github" | "fake";
  logTail: string;
  error: string | null;
  failure?: BuildFailure | null;
  artifactName: string | null;
  artifactSha256?: string | null;
  artifactSize?: number | null;
  /**
   * GitHub artifact ZIP container digest and byte count (ticket 13). The
   * download route serves the container, so these describe the response body;
   * `artifactSha256`/`artifactSize` stay the image facts from the manifest.
   */
  artifactContainerSha256?: string | null;
  artifactContainerSize?: number | null;
  /**
   * Engine the plan selected (ticket 13). Null on rows written before the queue
   * existed; readers fall back to the plan itself.
   */
  engine?: BuildEngine | null;
  /** Target id such as `x86/64` for V2 plans; null for V1 rows. */
  target?: string | null;
  /**
   * When the build left the queue (the dispatch attempt). Null while the build
   * is still queued; the reconciler uses it as the dispatch grace baseline.
   */
  dispatchedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The engine a plan dispatches to; legacy plans are ImageBuilder builds. */
export function buildEngineOf(plan: BuildPlan): BuildEngine {
  return plan.schemaVersion === 2 ? plan.engine : "imagebuilder";
}

/** The target id a V2 plan builds; legacy V1 plans have a fixed x86/64 target. */
export function buildTargetOf(plan: BuildPlan): string | null {
  return plan.schemaVersion === 2 ? plan.target.id : null;
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
  findRun(buildId: string, engine?: BuildEngine): Promise<string | null>;
  getRun(runId: string, expectedArtifactName?: string): Promise<RunUpdate>;
  cancelRun?(runId: string): Promise<void>;
  downloadArtifact(runId: string, artifactName: string): Promise<ArtifactDownload>;
}
