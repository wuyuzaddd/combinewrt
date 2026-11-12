import type { ImageFormatId, PackageSource, SourcePins } from "../catalog/types";

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
}

export interface ResolvedEntry {
  name: string;
  version: string | null;
  source: "selected" | "dependency";
  packageSource: PackageSource | null;
  sourcePin: string | null;
  sha256: string | null;
  feed: string | null;
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

export interface BuildPlan {
  baseVersion: string;
  feedCommit: string;
  sourceNote: string;
  sourcePins: SourcePins;
  config?: BuildConfig;
  profileId: string;
  profileTitle: string;
  imageType: ImageFormatId;
  packages: string[];
  topLevelPackages: string[];
  resolved: ResolvedEntry[];
  downloads: DownloadEntry[];
  missingDependencies: string[];
  conflicts: BuildConflict[];
  files: GeneratedFile[];
  artifactName: string;
  imageBuilderCommand: string;
  createdAt: string;
}
