import type { ImageFormatId } from "../catalog/types";
import type { ImageVariant } from "../domain/types";

/**
 * V2 artifact naming shared by the plan composer and the UI.
 *
 * The name is derived only from target, profile, boot, filesystem and artifact
 * so it is stable before a build starts, and it matches the file names the
 * upstream ImageBuilder writes into `bin/targets/<target>/<subtarget>/`:
 *
 * - combined: `<prefix>-<filesystem>-combined[-efi].img.gz`
 *   (`-efi` only for EFI; upstream has no `-legacy` suffix)
 * - VMDK/qcow2: `<prefix>-<filesystem>-combined[-efi].vmdk|qcow2`
 * - rootfs: `<prefix>-targz-rootfs.tar.gz` (the V1 rule: no filesystem or boot
 *   suffix, because the tarball is the same rootfs tree for every variant)
 * - eMMC: `<prefix>-<filesystem>-emmc.img.gz` (modelled only in V2.0)
 *
 * The filesystem is still part of the name where upstream includes it, so
 * every non-rootfs variant gets a distinct, stable file name.
 */
export interface ArtifactNameInput {
  baseVersion: string;
  targetId: string;
  profileId: string;
  imageVariant: ImageVariant;
}

export function artifactNameV2({
  baseVersion,
  targetId,
  profileId,
  imageVariant,
}: ArtifactNameInput): string {
  const targetSlug = targetId.replaceAll("/", "-");
  const prefix = `immortalwrt-${baseVersion}-${targetSlug}-${profileId}`;
  const { boot, filesystem, artifact } = imageVariant;
  const bootSuffix = boot === "efi" ? "-efi" : "";

  switch (artifact) {
    case "combined":
      return `${prefix}-${filesystem}-combined${bootSuffix}.img.gz`;
    case "rootfs":
      return `${prefix}-targz-rootfs.tar.gz`;
    case "vmdk":
      return `${prefix}-${filesystem}-combined${bootSuffix}.vmdk`;
    case "qcow2":
      return `${prefix}-${filesystem}-combined${bootSuffix}.qcow2`;
    case "emmc":
      return `${prefix}-${filesystem}-emmc.img.gz`;
  }
}

/**
 * V1 image-type compatibility: stored plans, the catalog adapter and the V1
 * workflow still read `imageType`. V2 commands key off the artifact name and
 * the variant mapping instead, so this only selects the V1 catalog format.
 */
export function imageTypeForVariant(variant: ImageVariant): ImageFormatId {
  if (variant.artifact === "rootfs") return "rootfs-tar";
  return variant.filesystem === "squashfs" ? "squashfs-efi" : "ext4-efi";
}
