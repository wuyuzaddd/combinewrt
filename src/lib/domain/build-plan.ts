import type { ImageFormatId, SourcePins } from "../catalog/types";
import type { ComplianceReport } from "../compliance";
import type {
  AppliedPatch,
  BuildConfig,
  BuildConflict,
  BuildVisibility,
  DownloadEntry,
  GeneratedFile,
  ModeState,
  ResolvedEntry,
} from "../build/types";
import type {
  BaseChannel,
  BuildEngine,
  DeviceProfile,
  ImageVariant,
  KernelLine,
  ModeRef,
  Target,
} from "./types";

/**
 * Fields shared by every persisted build plan. V2 plans keep all V1 fields so
 * existing pages, APIs and source offers keep rendering them.
 */
export interface BuildPlanBase {
  baseVersion: string;
  feedCommit: string;
  sourceNote: string;
  sourcePins: SourcePins;
  config?: BuildConfig;
  profileId: string;
  profileTitle: string;
  imageType: ImageFormatId;
  visibility?: BuildVisibility;
  packages: string[];
  topLevelPackages: string[];
  resolved: ResolvedEntry[];
  downloads: DownloadEntry[];
  missingDependencies: string[];
  conflicts: BuildConflict[];
  compliance?: ComplianceReport;
  patches?: AppliedPatch[];
  files: GeneratedFile[];
  artifactName: string;
  imageBuilderCommand: string;
  createdAt: string;
}

/**
 * A plan written before V2. `schemaVersion` may be absent on legacy rows; when
 * read it is treated as 1 and rendered read-only.
 */
export interface BuildPlanV1 extends BuildPlanBase {
  schemaVersion?: 1;
}

export interface BuildPlanV2 extends BuildPlanBase {
  schemaVersion: 2;
  channel: BaseChannel;
  target: Target;
  deviceProfile: DeviceProfile;
  kernelLine: KernelLine;
  imageVariant: ImageVariant;
  basePreset: ModeRef;
  overlays: ModeRef[];
  /**
   * Typed result of applying the base preset and overlays (ticket 07). Plans
   * written between tickets 03 and 07 have no such section; readers must treat
   * it as absent rather than an empty mode stack.
   */
  modes?: ModeState;
  engine: BuildEngine;
}

export type BuildPlan = BuildPlanV1 | BuildPlanV2;

export interface ReadableBuildPlan {
  plan: BuildPlan;
  schemaVersion: 1 | 2;
  /** V1 plans are immutable history: render them, never edit or re-plan them. */
  readOnly: boolean;
}

export function isBuildPlanV2(plan: BuildPlan): plan is BuildPlanV2 {
  return plan.schemaVersion === 2;
}

export function readBuildPlan(raw: unknown): ReadableBuildPlan {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("build plan must be a JSON object");
  }

  const schemaVersion = (raw as { schemaVersion?: unknown }).schemaVersion;
  if (schemaVersion === undefined || schemaVersion === 1) {
    return { plan: raw as BuildPlanV1, schemaVersion: 1, readOnly: true };
  }
  if (schemaVersion === 2) {
    return { plan: raw as BuildPlanV2, schemaVersion: 2, readOnly: false };
  }
  throw new Error(`unsupported build plan schemaVersion: ${String(schemaVersion)}`);
}

export function parseBuildPlanJson(json: string): ReadableBuildPlan {
  return readBuildPlan(JSON.parse(json) as unknown);
}
