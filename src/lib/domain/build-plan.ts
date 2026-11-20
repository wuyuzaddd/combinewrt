import type { ImageFormatId, SourcePins } from "../catalog/types";
import type { ImageFeedSet, ImagePreflight } from "../build/feeds";
import type { ComplianceReport } from "../compliance";
import type {
  AppliedPatch,
  BuildConfig,
  BuildConfigV2,
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
 * Fields shared by every persisted build plan. V2 plans keep the shape the
 * existing pages, APIs and source offers render. The two fields that would
 * force an `ImageFormatId` into a new write (`imageType` and the V1 config that
 * carries it) live on `BuildPlanV1` only (ADR 0009 ruling 4).
 */
export interface BuildPlanBase {
  baseVersion: string;
  feedCommit: string;
  sourceNote: string;
  sourcePins: SourcePins;
  profileId: string;
  profileTitle: string;
  visibility?: BuildVisibility;
  packages: string[];
  topLevelPackages: string[];
  resolved: ResolvedEntry[];
  downloads: DownloadEntry[];
  missingDependencies: string[];
  conflicts: BuildConflict[];
  /** Non-fatal planner notes (e.g. a removal that matched nothing); V1 plans may omit it. */
  warnings?: string[];
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
  /** V1 read path only: the single-image model's catalog format. */
  imageType: ImageFormatId;
  /** V1 form configuration, including its `imageType`. */
  config?: BuildConfig;
}

export interface BuildPlanV2 extends BuildPlanBase {
  schemaVersion: 2;
  /** V2 form configuration; no `imageType`, the variant is the model. */
  config?: BuildConfigV2;
  /**
   * Planner warnings (ticket 08). Optional so plans written before ticket 08
   * still read back; readers treat an absent list as "no warnings".
   */
  warnings?: string[];
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
  /**
   * Source-build kernel fragment contributed by kernel/config modes (ticket
   * 08). Optional for the same reason as `warnings`.
   */
  kernelConfig?: string[];
  /** Docker data root when the docker mode is selected (ticket 08). */
  docker?: { dataRoot: string };
  /**
   * Image package feed set (ticket 09). Optional so plans written before the
   * feed set existed still read back; readers treat absence as "unknown".
   */
  feedSet?: ImageFeedSet;
  /** Exact installability preflight the workflow runs before `make image`. */
  preflight?: ImagePreflight;
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
