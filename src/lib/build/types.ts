import type { ImageFormatId } from "../catalog/types";

export interface BuildFormInput {
  profile: string;
  imageType: ImageFormatId;
  hostname: string;
  timezone: string;
  lanIp: string;
  netmask: string;
  rootPassword: string;
  packages: string[];
}

export interface PackageLookupEntry {
  version: string;
  depends: string[];
}

export type PackageLookup = (name: string) => PackageLookupEntry | null;

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
  config?: BuildConfig;
  profileId: string;
  profileTitle: string;
  imageType: ImageFormatId;
  packages: string[];
  resolved: ResolvedEntry[];
  missingDependencies: string[];
  conflicts: BuildConflict[];
  files: GeneratedFile[];
  artifactName: string;
  imageBuilderCommand: string;
  createdAt: string;
}
