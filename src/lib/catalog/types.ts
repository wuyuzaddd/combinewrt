export type ImageFormatId = "ext4-efi" | "squashfs-efi" | "rootfs-tar";

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
}

export interface SnapshotInput {
  baseVersion: string;
  feedCommit: string;
  sourceNote: string;
  profiles: CatalogProfile[];
  packages: CatalogPackage[];
}

export interface SnapshotMeta {
  id: number;
  baseVersion: string;
  feedCommit: string;
  sourceNote: string;
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
