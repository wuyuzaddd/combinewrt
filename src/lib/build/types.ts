import type { ImageFormatId, PackageSource } from "../catalog/types";
import type { AcquisitionStrategy, SourceLayer } from "../sources/types";
import type { BasePresetId, ImageVariant, ModeRef } from "../domain/types";

export interface RequestedPackage {
  name: string;
  source?: PackageSource;
  version?: string;
}

export interface PackagePin {
  name: string;
  source?: PackageSource;
  version?: string;
  sha256?: string;
}

export type BuildVisibility = "private" | "public";

export interface BuildFormInput {
  profile: string;
  imageType: ImageFormatId;
  hostname: string;
  timezone: string;
  lanIp: string;
  netmask: string;
  rootPassword: string;
  packages: string[];
  packagePins?: PackagePin[];
  visibility?: BuildVisibility;
}

/**
 * Input of the V2 planner. V1 fields remain readable so a V1 form (or a stored
 * V1 plan's config) can still be loaded; the target/profile/variant triple is
 * what makes a form V2. `imageType` is optional because the composer derives it
 * from the image variant.
 */
export interface BuildFormInputV2 extends Omit<BuildFormInput, "imageType"> {
  imageType?: ImageFormatId;
  target: string;
  kernelLine: string;
  imageVariant: ImageVariant;
  /** Base preset id; the composer defaults to `minimal`. */
  basePreset?: BasePresetId;
  /** Declared configuration modes that stack on the base preset (ticket 07). */
  modes?: ModeRef[];
}

export interface PackageLookupEntry {
  version: string;
  depends: string[];
  source: PackageSource;
  sourcePin: string;
  sha256: string | null;
  filename: string | null;
  downloadUrl: string | null;
  feed: string;
  license?: string | null;
  proprietary?: boolean;
}

export type PackageLookup = (name: string) => PackageLookupEntry | null;
export type PackageLookupAll = (name: string) => PackageLookupEntry[];

export interface BuildConfig {
  profile: string;
  imageType: ImageFormatId;
  hostname: string;
  timezone: string;
  lanIp: string;
  netmask: string;
  packages: string[];
  visibility?: BuildVisibility;
}

export interface ResolvedEntry {
  name: string;
  version: string | null;
  source: "selected" | "dependency";
  packageSource: PackageSource | null;
  sourcePin: string | null;
  sha256: string | null;
  feed: string | null;
  license?: string | null;
  proprietary?: boolean;
  /** Acquisition strategy the registry asks for (V2 plans only). */
  requestedStrategy?: AcquisitionStrategy;
  /** Strategy the planner will actually use (V2 plans only). */
  effectiveStrategy?: AcquisitionStrategy;
  /** Why `effectiveStrategy` differs from `requestedStrategy` (V2 plans only). */
  fallbackReason?: string;
}

export interface AppliedPatch {
  name: string;
  license: "GPL-2.0-only";
  source: string;
}

export interface DownloadEntry {
  name: string;
  version: string;
  source: Exclude<PackageSource, "official">;
  sourcePin: string;
  url: string;
  filename: string;
  sha256: string;
}

export interface BuildConflict {
  names: string[];
  message: string;
}

export interface GeneratedFile {
  path: string;
  content: string;
  mode: number;
}

export type { AcquisitionStrategy, SourceLayer };
export type { BuildPlan, BuildPlanV1, BuildPlanV2 } from "../domain/build-plan";
