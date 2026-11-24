export type ImageFormatId = "ext4-efi" | "squashfs-efi" | "rootfs-tar";

/**
 * Package acquisition layers. `extension` is the curated extension feed
 * (ticket 12): its packages resolve from the source registry instead of a
 * catalog snapshot.
 */
export type PackageSource = "official" | "dllkids" | "supplement" | "extension";

export const PACKAGE_SOURCES: readonly PackageSource[] = ["official", "dllkids", "supplement", "extension"];

/**
 * Tie-break when two feeds publish the same package name.
 *
 * Policy (2026-11-24): the official ImmortalWrt feeds win by default, then the
 * third-party dllkids feed for names official does not carry, then our curated
 * self-built feeds (supplement, extension).
 */
export function sourcePriority(source: PackageSource): number {
  if (source === "official") return 0;
  if (source === "dllkids") return 1;
  if (source === "supplement") return 2;
  return 3;
}

export const KERNEL_VERMAGIC_PIN = "6.12.103-1-0413601b1c3f0490e17f340fe09229ea";

export interface SupplementPin {
  commit: string | null;
  fingerprint: string | null;
  /** sha256 of the signed packages.adb this snapshot was built from. */
  indexSha256?: string | null;
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
  /**
   * APK package hash from the feed index, as recomputed by `apk mkndx`.
   * This is NOT the SHA-256 of the .apk file bytes; the workflow logs that
   * separately as COMBINEWRT_DOWNLOAD_SHA256.
   */
  sha256: string | null;
  fileSize: number;
  filename: string | null;
  downloadUrl: string | null;
  kmod: boolean;
}

export interface SnapshotInput {
  baseVersion: string;
  /** OpenWrt target id; V1 callers omit it and get the x86/64 default. */
  target?: string;
  feedCommit: string;
  sourceNote: string;
  sourcePins: SourcePins;
  profiles: CatalogProfile[];
  packages: CatalogPackage[];
}

export interface SnapshotMeta {
  id: number;
  baseVersion: string;
  target: string;
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
