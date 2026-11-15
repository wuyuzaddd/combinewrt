import type { ImageFormatId } from "../catalog/types";
import type { ImageVariant } from "../domain/types";

/**
 * Placeholder V2 artifact naming shared by the plan composer and the UI.
 *
 * The name is derived only from target, profile, boot, filesystem and artifact
 * so it is stable before a build starts. Ticket 04 owns the final
 * variant→ImageBuilder product mapping and qemu-img postprocessing; it should
 * replace this module rather than duplicate the rule.
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

  switch (artifact) {
    case "combined":
      return `${prefix}-${filesystem}-combined-${boot}.img.gz`;
    case "rootfs":
      return `${prefix}-${filesystem}-rootfs.tar.gz`;
    case "vmdk":
      return `${prefix}-${filesystem}-${boot}.vmdk`;
    case "qcow2":
      return `${prefix}-${filesystem}-${boot}.qcow2`;
    case "emmc":
      return `${prefix}-${filesystem}-emmc.img.gz`;
  }
}

/**
 * V1 image-type compatibility: stored plans and the GitHub adapter still read
 * `imageType`. Ticket 04 replaces this with the real variant mapping.
 */
export function imageTypeForVariant(variant: ImageVariant): ImageFormatId {
  if (variant.artifact === "rootfs") return "rootfs-tar";
  return variant.filesystem === "squashfs" ? "squashfs-efi" : "ext4-efi";
}
