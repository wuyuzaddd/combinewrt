import type { CapabilityRegistry, CapabilityRejection, ProfileRef } from "../catalog/capabilities";
import { getProfile, supportsVariant } from "../catalog/capabilities";
import type { ImageFormatId } from "../catalog/types";
import type { ImageVariant } from "../domain/types";
import { artifactNameV2, imageTypeForVariant } from "../build/artifact-name";
import { convertedArtifactKind, planPostprocess, type PostprocessPlan } from "./postprocess";

/**
 * Map an `ImageVariant` (boot × filesystem × artifact kind × overlay) to the
 * ImageBuilder products, configuration and final file names.
 *
 * The upstream x86 ImageBuilder recipe (`target/linux/x86/image/Makefile`) gates
 * products with Kconfig symbols that also work as make variables, which is how
 * the V1 workflow already selects images:
 *
 * - `CONFIG_GRUB_IMAGES` / `CONFIG_GRUB_EFI_IMAGES` select the Legacy / EFI
 *   `combined[-efi].img.gz` products.
 * - `CONFIG_TARGET_ROOTFS_EXT4FS` / `CONFIG_TARGET_ROOTFS_SQUASHFS` select the
 *   root filesystem, `CONFIG_TARGET_ROOTFS_TARGZ` enables the rootfs tarball.
 * - `CONFIG_TARGET_ROOTFS_PARTSIZE` sizes the ext4 rootfs/overlay partition.
 * - The other image kinds are kept off: VMDK/qcow2 are converted from the raw
 *   combined image instead of being built by qemu-image, so postprocessing owns
 *   their naming and manifests.
 *
 * The capability registry remains the authority on *what is allowed*; this
 * module only maps a variant the plan has already accepted.
 */
export interface OverlayMapping {
  sizeMb?: number;
  /** Set when the requested size maps to an ImageBuilder config override. */
  configKey?: "CONFIG_TARGET_ROOTFS_PARTSIZE";
  /** Where the size came from; `none` for artifacts without an overlay. */
  source: "variant" | "profile-default" | "none";
}

export interface ImageVariantMapping {
  /** The variant after rootfs overlay stripping; the effective overlay is in `overlay`. */
  variant: ImageVariant;
  artifactName: string;
  artifactPath: string;
  /** `bin/targets/<target>/<subtarget>` inside the ImageBuilder tree. */
  productDir: string;
  /** V1 catalog image type; V2 commands key off the artifact name instead. */
  imageType: ImageFormatId;
  /** ImageBuilder make variables/`.config` values for this variant. */
  config: Record<string, string>;
  /** `KEY=value` lines for the workflow, in the same order as `config`. */
  initCommands: string[];
  /** Make goals that produce the artifact, e.g. `["image"]`. */
  makeTargets: string[];
  /** Files the build must produce under `productDir` (before postprocessing). */
  products: string[];
  /** Raw combined product a VMDK/qcow2 variant converts from. */
  sourceArtifactName?: string;
  postprocess?: PostprocessPlan;
  overlay: OverlayMapping;
}

export interface MapVariantInput {
  baseVersion: string;
  targetId: string;
  profileId: string;
  variant: ImageVariant;
  /** Overrides `bin/targets/<targetId>`; mostly for tests and fixtures. */
  productDir?: string;
}

export interface SupportedVariantInput {
  baseVersion: string;
  /** Target + profile pair, the same reference `supportsVariant` resolves. */
  profileRef: ProfileRef;
  kernelLine: string;
  variant: ImageVariant;
  registry?: CapabilityRegistry;
  productDir?: string;
}

export type ImageVariantErrorCode = "variant-unsupported" | "unknown-artifact";

/** A variant the capability registry refuses; the plan turns this into a readable 400. */
export class ImageVariantError extends Error {
  readonly code: ImageVariantErrorCode;
  readonly reason?: CapabilityRejection;

  constructor(code: ImageVariantErrorCode, message: string, reason?: CapabilityRejection) {
    super(message);
    this.name = "ImageVariantError";
    this.code = code;
    this.reason = reason;
  }
}

/** Rootfs tarballs have no overlay dimension; everything else keeps the supplied size. */
export function resolveImageVariant(variant: ImageVariant, defaultOverlayMb: number): ImageVariant {
  if (variant.artifact === "rootfs") {
    return { boot: variant.boot, filesystem: variant.filesystem, artifact: variant.artifact };
  }
  return {
    boot: variant.boot,
    filesystem: variant.filesystem,
    artifact: variant.artifact,
    overlaySizeMb: variant.overlaySizeMb ?? defaultOverlayMb,
  };
}

function combinedProductName(input: MapVariantInput): string {
  return artifactNameV2({
    baseVersion: input.baseVersion,
    targetId: input.targetId,
    profileId: input.profileId,
    imageVariant: { boot: input.variant.boot, filesystem: input.variant.filesystem, artifact: "combined" },
  });
}

function overlayMapping(variant: ImageVariant): OverlayMapping {
  if (variant.artifact === "rootfs") return { sizeMb: undefined, source: "none" };
  if (variant.overlaySizeMb === undefined) return { sizeMb: undefined, source: "profile-default" };
  if (variant.filesystem === "ext4") {
    return { sizeMb: variant.overlaySizeMb, source: "variant", configKey: "CONFIG_TARGET_ROOTFS_PARTSIZE" };
  }
  // The squashfs combined image takes its partition layout from the target
  // capability, so the requested size is validated but not passed as a config
  // override.
  return { sizeMb: variant.overlaySizeMb, source: "variant" };
}

function imageBuilderConfig(variant: ImageVariant, overlay: OverlayMapping): Record<string, string> {
  const config: Record<string, string> = {
    CONFIG_TARGET_IMAGES_GZIP: "y",
    CONFIG_GRUB_IMAGES: variant.boot === "legacy" ? "y" : "n",
    CONFIG_GRUB_EFI_IMAGES: variant.boot === "efi" ? "y" : "n",
    CONFIG_ISO_IMAGES: "n",
    CONFIG_VDI_IMAGES: "n",
    CONFIG_VHDX_IMAGES: "n",
    CONFIG_VMDK_IMAGES: "n",
    CONFIG_QCOW2_IMAGES: "n",
    CONFIG_TARGET_ROOTFS_EXT4FS: variant.filesystem === "ext4" ? "y" : "n",
    CONFIG_TARGET_ROOTFS_SQUASHFS: variant.filesystem === "squashfs" ? "y" : "n",
    CONFIG_TARGET_ROOTFS_TARGZ: variant.artifact === "rootfs" ? "y" : "n",
  };
  if (overlay.configKey && overlay.sizeMb !== undefined) {
    config[overlay.configKey] = String(overlay.sizeMb);
  }
  return config;
}

export function mapImageVariant(input: MapVariantInput): ImageVariantMapping {
  const variant: ImageVariant =
    input.variant.artifact === "rootfs"
      ? { boot: input.variant.boot, filesystem: input.variant.filesystem, artifact: "rootfs" }
      : input.variant;

  const artifactName = artifactNameV2({
    baseVersion: input.baseVersion,
    targetId: input.targetId,
    profileId: input.profileId,
    imageVariant: variant,
  });
  const productDir = input.productDir ?? `bin/targets/${input.targetId}`;
  const overlay = overlayMapping(variant);
  const config = imageBuilderConfig(variant, overlay);
  const kind = convertedArtifactKind(variant.artifact);

  let products: string[] = [artifactName];
  let sourceArtifactName: string | undefined;
  let postprocess: PostprocessPlan | undefined;

  if (kind) {
    sourceArtifactName = combinedProductName(input);
    products = [sourceArtifactName];
    const sourcePath = `${productDir}/${sourceArtifactName}`;
    postprocess = planPostprocess({
      kind,
      sourcePath,
      rawPath: sourcePath.replace(/\.gz$/, ""),
      outputPath: `${productDir}/${artifactName}`,
    });
  }

  return {
    variant,
    artifactName,
    artifactPath: `${productDir}/${artifactName}`,
    productDir,
    imageType: imageTypeForVariant(variant),
    config,
    initCommands: Object.entries(config).map(([key, value]) => `${key}=${value}`),
    makeTargets: ["image"],
    products,
    ...(sourceArtifactName ? { sourceArtifactName } : {}),
    ...(postprocess ? { postprocess } : {}),
    overlay,
  };
}

/**
 * Capability-checked mapping. Rejects an undeclared/unsupported variant or an
 * out-of-range overlay through `supportsVariant`, applies the profile's overlay
 * default when the request omits one, then maps the accepted variant.
 */
export function mapSupportedImageVariant(input: SupportedVariantInput): ImageVariantMapping {
  const support = supportsVariant(input.profileRef, input.kernelLine, input.variant, input.registry);
  if (!support.supported) {
    throw new ImageVariantError("variant-unsupported", support.reason.message, support.reason);
  }

  const profile = getProfile(input.profileRef.targetId, input.profileRef.id, input.registry);
  const resolved = resolveImageVariant(input.variant, profile.overlay.defaultMb);
  const mapping = mapImageVariant({
    baseVersion: input.baseVersion,
    targetId: input.profileRef.targetId,
    profileId: input.profileRef.id,
    variant: resolved,
    ...(input.productDir ? { productDir: input.productDir } : {}),
  });

  if (input.variant.overlaySizeMb === undefined && mapping.variant.overlaySizeMb !== undefined) {
    return { ...mapping, overlay: { ...mapping.overlay, source: "profile-default" } };
  }
  return mapping;
}
