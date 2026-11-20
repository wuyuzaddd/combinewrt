import type { ImageFeedSet, ImagePreflight } from "../build/feeds";
import type { SourceRecipe } from "../build/source";
import type { ImageFormatId, SourcePins } from "../catalog/types";
import { assertSafeGeneratedFiles } from "../build/dispatch-files";
import type { DownloadEntry, GeneratedFile, ModeState } from "../build/types";
import type { BuildPlan, BuildPlanV2 } from "../domain/build-plan";
import { isBuildPlanV2 } from "../domain/build-plan";
import type { BuildEngine, ImageVariant, KernelLine, Target } from "../domain/types";
import type { ImageVariantMapping } from "../image/variants";
import { mapImageVariant } from "../image/variants";
import { buildSourceDispatchPayload, loadSourceRecipe, type SourceDispatchPayload } from "./source-dispatch";

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
    /**
     * The already-accepted mode/network state (ticket 11). The route answers
     * 409 on form-level conflicts, so anything that reaches dispatch is final.
     */
    modes?: ModeState;
    /**
     * Image feed set and installability preflight (ticket 09). They sit next to
     * `modes` (not inside `v2`) because the workflow preflight step reads
     * `.composition.feedSet` / `.composition.preflight` for both plan shapes.
     */
    feedSet?: ImageFeedSet;
    preflight?: ImagePreflight | null;
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
  // Ticket 05: the workflow is the trust boundary, but the site must never hand
  // it a files[] entry that escapes the overlay or carries an unexpected mode.
  // V1 and V2 plans go through the same predicate.
  assertSafeGeneratedFiles(plan.files);

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
    composition: {
      ...payload.composition,
      // The workflow never re-derives the mode stack; it receives the final one.
      ...(plan.modes ? { modes: plan.modes } : {}),
      // Ticket 09: the workflow writes the feed set and preflights the exact
      // install list before `make image`.
      ...(plan.feedSet ? { feedSet: plan.feedSet, preflight: plan.preflight ?? null } : {}),
      v2: planV2Payload(plan, mapping),
    },
  };
}

/** Repository event types the site may send to the build repository. */
export type DispatchEventType = "combinewrt-build" | "combinewrt-source-build";

/** One dispatch: which repository event to send and the exact payload. */
export interface DispatchRequest {
  eventType: DispatchEventType;
  payload: DispatchPayload | SourceDispatchPayload;
}

export interface BuildDispatchRequestOptions {
  now?: Date;
  /** Test seam: replace the config-backed source recipe loader. */
  sourceRecipe?: (plan: BuildPlanV2, meta: DispatchMeta) => SourceRecipe;
}

/**
 * Choose the dispatch path for a plan (ticket 13). A V2 plan whose engine is
 * `source` sends ticket 06's recipe to `combinewrt-source-build`; every other
 * plan keeps the ImageBuilder payload the workflow has always read. This is
 * the only place the two engines are selected, so a source build cannot fall
 * back to ImageBuilder by accident.
 */
export function buildDispatchRequest(
  plan: BuildPlan,
  meta: DispatchMeta,
  options: BuildDispatchRequestOptions = {},
): DispatchRequest {
  if (plan.schemaVersion === 2 && plan.engine === "source") {
    const recipe = options.sourceRecipe
      ? options.sourceRecipe(plan, meta)
      : loadSourceRecipe(plan, { now: options.now });
    return {
      eventType: "combinewrt-source-build",
      payload: buildSourceDispatchPayload(recipe, meta.buildId),
    };
  }
  return { eventType: "combinewrt-build", payload: buildDispatchPayload(plan, meta) };
}
