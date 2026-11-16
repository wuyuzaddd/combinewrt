import type { PublishGateReason, PublishMode } from "./recipe";

export type SupplementPublishStatus =
  | "dispatched"
  | "running"
  | "published"
  | "staged"
  | "failed"
  | "publish_pending";

export type SupplementPublishTrigger = "schedule" | "webhook" | "manual";

export interface SupplementPublishRecord {
  id: number;
  baseVersion: string;
  target: string;
  sourceCommit: string;
  recipeHash: string;
  spdx: string;
  publicAllowed: boolean;
  packageSetShape: string[];
  metadataFingerprint: string;
  publishMode: PublishMode;
  gateReason: PublishGateReason;
  trigger: SupplementPublishTrigger;
  buildRunId: string | null;
  buildRunUrl: string | null;
  status: SupplementPublishStatus;
  reason: string | null;
  indexSha256: string | null;
  keyFingerprint: string | null;
  frozenPath: string | null;
  promotedAt: string | null;
  promotedBy: string | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
}

export interface SupplementPublishEvent {
  id: number;
  publishId: number;
  fromStatus: SupplementPublishStatus | null;
  toStatus: SupplementPublishStatus;
  reason: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
}

/** Metadata persisted on the `supplement` source pin. */
export interface SupplementPinMetadata {
  baseVersion?: string;
  target?: string;
  recipeHash?: string;
  spdx?: string;
  publicAllowed?: boolean;
  packageSetShape?: string[];
  metadataFingerprint?: string;
  buildRunId?: string | null;
  indexSha256?: string | null;
  keyFingerprint?: string | null;
  frozenPath?: string | null;
  publishedAt?: string | null;
}

/** What the feed repo's publish/staging audit record says about a build run. */
export interface FeedPublishRecord {
  channel: PublishMode;
  buildRunId: string;
  baseVersion: string;
  target: string;
  sourceCommit: string;
  indexSha256: string;
  keyFingerprint: string;
  frozenPath: string;
  publishedAt: string;
  promotedFromStaging?: boolean;
}
