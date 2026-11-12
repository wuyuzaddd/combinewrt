export type ImageFormatId = "ext4-efi" | "squashfs-efi" | "rootfs-tar";

export type PackageSource = "official" | "dllkids" | "supplement";

export const PACKAGE_SOURCES: readonly PackageSource[] = ["official", "dllkids", "supplement"];

export function sourcePriority(source: PackageSource): number {
  return source === "official" ? 0 : source === "dllkids" ? 1 : 2;
}

export interface SupplementPin {
  commit: string | null;
  fingerprint: string | null;
}

export interface KernelPin {
  version: string;
  release: string;
  vermagic: string;
}

export interface SourcePins {
  official: Record<string, string>;
  dllkids: string | null;
  supplement: SupplementPin | null;
  kernel: KernelPin | null;
}

export const EMPTY_SOURCE_PINS: SourcePins = {
  official: {},
  dllkids: null,
  supplement: null,
  kernel: null,
};

export interface CatalogProfile {
  id: string;
  title: string;
  formats: ImageFormatId[];
  imageCount: number;
}

export interface CatalogPackage {
  name: string;
  version: string;
  arch: string;
  description: string;
  license: string | null;
  origin: string | null;
  category: string;
  installedSize: number;
  depends: string[];
  feed: string;
  proprietary: boolean;
  source: PackageSource;
  sourcePin: string;
  sha256: string | null;
  fileSize: number;
  filename: string | null;
  downloadUrl: string | null;
  kmod: boolean;
}

export interface SnapshotInput {
  baseVersion: string;
  feedCommit: string;
  sourceNote: string;
  sourcePins: SourcePins;
  profiles: CatalogProfile[];
  packages: CatalogPackage[];
}

export interface SnapshotMeta {
  id: number;
  baseVersion: string;
  feedCommit: string;
  sourceNote: string;
  sourcePins: SourcePins;
  createdAt: string;
  profileCount: number;
  packageCount: number;
}

export interface PackageSearchOptions {
  query?: string;
  category?: string;
  limit?: number;
  offset?: number;
}

export interface PackageSearch {
  items: CatalogPackage[];
  total: number;
}
