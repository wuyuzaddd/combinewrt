import type { ImageFormatId, SourcePins } from "../catalog/types";
import type { DownloadEntry, GeneratedFile } from "../build/types";
import type { BuildPlan, BuildPlanV2 } from "../domain/build-plan";
import { isBuildPlanV2 } from "../domain/build-plan";
import type { BuildEngine, ImageVariant, KernelLine, Target } from "../domain/types";
import type { ImageVariantMapping } from "../image/variants";
import { mapImageVariant } from "../image/variants";

/**
 * The `client_payload` of a `combinewrt-build` repository_dispatch event.
 *
 * V1 plans send exactly the ten top-level properties the workflow has always
 * read. V2 plans keep those ten properties byte-for-byte and add
 * `composition.v2`, because `repository_dispatch.client_payload` may have at
 * most ten top-level properties (the workflow must still receive a plan it can
 * build without a second round trip).
 */
export interface DispatchPayloadV2 {
  schemaVersion: 2;
  engine: BuildEngine;
  target: Target;
  kernelLine: KernelLine;
  imageVariant: ImageVariant;
  /** Declared configuration mode ids, stacked on the base preset (ticket 07). */
  modes: string[];
  /** Product file names the build must produce, before postprocessing. */
  products: string[];
  makeTargets: string[];
}

export interface DispatchPayload {
  buildId: string;
  baseVersion: string;
  feedCommit: string;
  profileId: string;
  imageType: ImageFormatId;
  packages: string[];
  composition: {
    topLevelPackages: string[];
    sourcePins: SourcePins;
    downloads: DownloadEntry[];
    v2?: DispatchPayloadV2;
  };
  files: GeneratedFile[];
  artifactName: string;
  imageBuilderCommand: string;
}

export interface DispatchMeta {
  buildId: string;
  artifactName: string;
}

/**
 * Render the `make` command the ImageBuilder workflow runs. The make variables
 * are the `initCommands` the variant mapping derives from the accepted variant,
 * so `src/lib/image/variants.ts` stays the single authority for the target
 * configuration; `.github/scripts/variant-config.sh` reproduces the same list
 * and `src/lib/build/workflow.test.ts` fails if the two sides drift.
 */
export function imageBuilderCommandForVariant(
  mapping: ImageVariantMapping,
  profileId: string,
  packages: string[],
): string {
  const config = mapping.initCommands.length > 0 ? ` ${mapping.initCommands.join(" ")}` : "";
  return `make -j$(nproc) ${mapping.makeTargets.join(" ")} PROFILE=${profileId} PACKAGES="${packages.join(" ")}" FILES=files${config}`;
}

function planV2Payload(plan: BuildPlanV2, mapping: ImageVariantMapping): DispatchPayloadV2 {
  return {
    schemaVersion: 2,
    engine: plan.engine,
    target: plan.target,
    kernelLine: plan.kernelLine,
    imageVariant: mapping.variant,
    modes: plan.overlays.map((mode) => mode.id),
    products: mapping.products,
    makeTargets: mapping.makeTargets,
  };
}

export function buildDispatchPayload(plan: BuildPlan, meta: DispatchMeta): DispatchPayload {
  const payload: DispatchPayload = {
    buildId: meta.buildId,
    baseVersion: plan.baseVersion,
    feedCommit: plan.feedCommit,
    profileId: plan.profileId,
    imageType: plan.imageType,
    packages: plan.packages,
    composition: {
      topLevelPackages: plan.topLevelPackages,
      sourcePins: plan.sourcePins,
      downloads: plan.downloads,
    },
    files: plan.files,
    artifactName: meta.artifactName,
    imageBuilderCommand: plan.imageBuilderCommand,
  };

  if (!isBuildPlanV2(plan)) return payload;

  const mapping = mapImageVariant({
    baseVersion: plan.baseVersion,
    targetId: plan.target.id,
    profileId: plan.profileId,
    variant: plan.imageVariant,
  });
  return {
    ...payload,
    // V2 builds must run the variant-derived command, not the V1 formula.
    imageBuilderCommand: imageBuilderCommandForVariant(mapping, plan.profileId, plan.packages),
    composition: { ...payload.composition, v2: planV2Payload(plan, mapping) },
  };
}
