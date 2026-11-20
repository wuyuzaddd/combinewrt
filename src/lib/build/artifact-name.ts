import { IMAGE_FORMATS } from "../catalog/profiles";
import type { ImageFormatId } from "../catalog/types";
import { isBuildPlanV2 } from "../domain/build-plan";
import type { BuildPlan } from "../domain/build-plan";
import type { ImageVariant } from "../domain/types";

/**
 * Artifact naming, split by plan schema (ADR 0009 ruling 4).
 *
 * - `artifactNameV1` is the frozen V1 rule. It is a read path: stored V1 plans,
 *   the V1 workflow branch and any legacy name we must reproduce byte-for-byte.
 * - `artifactNameV2` is the only naming function a new write may use. It takes
 *   the four-dimensional `ImageVariant` and never an `ImageFormatId`.
 *
 * Both rules agree for equivalent combinations (ext4 EFI combined, squashfs EFI
 * combined, rootfs tarball); `artifact-name.test.ts` pins the parity and the
 * eight accepted V2 combinations.
 *
 * The V2 name is derived only from target, profile, boot, filesystem and
 * artifact, so it is stable before a build starts, and it matches the file
 * names the upstream ImageBuilder writes into `bin/targets/<target>/<subtarget>/`:
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
export interface ArtifactNameInputV1 {
  baseVersion: string;
  profileId: string;
}

export interface ArtifactNameInput {
  baseVersion: string;
  targetId: string;
  profileId: string;
  imageVariant: ImageVariant;
}

/**
 * V1 naming rule (read/legacy only). The V1 model has a single x86/64 target,
 * so the target is fixed at `x86-64` and the filesystem/boot choice is the
 * catalog format suffix.
 */
export function artifactNameV1(imageType: ImageFormatId, { baseVersion, profileId }: ArtifactNameInputV1): string {
  const format = IMAGE_FORMATS.find((item) => item.id === imageType);
  if (!format) throw new Error(`unknown image type: ${imageType}`);
  return `immortalwrt-${baseVersion}-x86-64-${profileId}${format.suffix}`;
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
 * V1 image-type compatibility: the V1-compatible dispatch payload, stored V1
 * plans and the workflow's format assertion still read `imageType`. V2 plans
 * key off the artifact name and the variant mapping instead, so this only
 * selects the V1 catalog format.
 */
export function imageTypeForVariant(variant: ImageVariant): ImageFormatId {
  if (variant.artifact === "rootfs") return "rootfs-tar";
  return variant.filesystem === "squashfs" ? "squashfs-efi" : "ext4-efi";
}

/**
 * The `ImageFormatId` a stored plan renders as: its stored V1 field, or the
 * format equivalent of a V2 plan's variant. Read path only -- a V2 plan never
 * stores the value (ADR 0009 ruling 4).
 */
export function imageTypeForPlan(plan: BuildPlan): ImageFormatId {
  return isBuildPlanV2(plan) ? imageTypeForVariant(plan.imageVariant) : plan.imageType;
}

/**
 * Inverse of `imageTypeForVariant`, used only to read a legacy V1 form. A
 * `rootfs-tar` build has no boot/filesystem choice, so it maps to the canonical
 * squashfs EFI rootfs variant the V2 planner supports.
 */
export function variantForImageType(imageType: ImageFormatId): ImageVariant {
  switch (imageType) {
    case "ext4-efi":
      return { boot: "efi", filesystem: "ext4", artifact: "combined" };
    case "squashfs-efi":
      return { boot: "efi", filesystem: "squashfs", artifact: "combined" };
    case "rootfs-tar":
      return { boot: "efi", filesystem: "squashfs", artifact: "rootfs" };
  }
}
