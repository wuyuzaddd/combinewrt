import type { BuildPlan } from "../build/types";

export type BuildStatus = "queued" | "running" | "succeeded" | "failed";

export interface BuildRecord {
  id: string;
  plan: BuildPlan;
  status: BuildStatus;
  runId: string | null;
  adapter: "github" | "fake";
  logTail: string;
  error: string | null;
  artifactName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RunUpdate {
  status: BuildStatus;
  logTail?: string;
  error?: string | null;
  artifactName?: string | null;
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
  downloadArtifact(runId: string, artifactName: string): Promise<ArtifactDownload>;
}
