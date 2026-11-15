import type { BuildPlanV1, BuildPlanV2 } from "../domain/build-plan";
import { CapabilityError, getKernelLine, getProfile, getTarget, loadCapabilities, supportsMode, supportsVariant, type CapabilityRegistry } from "../catalog/capabilities";
import type { CatalogProfile, SourcePins } from "../catalog/types";
import type { BaseChannel, BuildEngine, ImageVariant } from "../domain/types";
import { EMPTY_SOURCE_REGISTRY } from "../sources/registry";
import { decideStrategy } from "../sources/strategy";
import type { SourceRegistry } from "../sources/types";
import { artifactNameV2, imageTypeForVariant } from "./artifact-name";
import { resolveModes } from "./modes";
import { createBuildPlan } from "./plan";
import type { BuildConflict, BuildFormInputV2, PackageLookup, PackageLookupAll } from "./types";

/**
 * V2 planner context. The capability registry and the source registry are
 * injected so ticket 12 can pass the real source registry and tests can pass
 * fixtures without touching disk.
 */
export interface PlanV2Context {
  baseVersion: string;
  channel?: BaseChannel;
  feedCommit: string;
  sourceNote: string;
  sourcePins?: SourcePins;
  /** Profiles of the active catalog snapshot; used for the V1 plan fields. */
  catalogProfiles: readonly CatalogProfile[];
  /** Capability registry; defaults to the checked-in `config/capabilities/targets.json`. */
  capabilities?: CapabilityRegistry;
  /** Unified source registry; defaults to empty so V1 catalog pins stay `prebuilt`. */
  sources?: SourceRegistry;
  lookup: PackageLookup;
  lookupAll?: PackageLookupAll;
  hashPassword: (password: string) => Promise<string>;
  now?: Date;
}

export interface PlanV2Success {
  ok: true;
  plan: BuildPlanV2;
  conflicts: BuildConflict[];
}

/** A form the capability registry refuses; the route answers 400. */
export interface PlanV2Failure {
  ok: false;
  status: 400;
  issues: string[];
}

export type PlanV2Outcome = PlanV2Success | PlanV2Failure;

function reject(issue: string): PlanV2Failure {
  return { ok: false, status: 400, issues: [issue] };
}

function resolveVariant(variant: ImageVariant, defaultOverlayMb: number): ImageVariant {
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

/**
 * V2 plan composer.
 *
 * Order (spec "Build plan and engine"): validate the form against the
 * capability registry → resolve the kernel line / engine → validate the image
 * variant and modes → delegate package resolution, compliance and UCI output
 * to the V1 composer → annotate the V2 fields and decide the acquisition
 * strategy per resolved package through the source registry.
 *
 * It never runs for a V1 form: the route only calls it when the request names
 * the V2 target/kernel-line/variant triple.
 */
export async function createBuildPlanV2(
  form: BuildFormInputV2,
  context: PlanV2Context,
): Promise<PlanV2Outcome> {
  const registry = context.capabilities ?? loadCapabilities();

  let target;
  let profile;
  let kernel;
  try {
    target = getTarget(form.target, registry);
    profile = getProfile(form.target, form.profile, registry);
    kernel = getKernelLine(form.kernelLine, registry);
  } catch (error) {
    if (error instanceof CapabilityError) return reject(error.message);
    throw error;
  }

  const variantSupport = supportsVariant({ targetId: target.id, id: profile.id }, kernel.id, form.imageVariant, registry);
  if (!variantSupport.supported) return reject(variantSupport.reason.message);

  const overlays = form.modes ?? [];
  for (const mode of overlays) {
    const modeSupport = supportsMode({ targetId: target.id, id: profile.id }, mode.id, registry);
    if (!modeSupport.supported) return reject(modeSupport.reason.message);
    if (modeSupport.mode.requiresEngine && modeSupport.mode.requiresEngine !== kernel.engine) {
      return reject(
        `Mode "${mode.id}" requires the ${modeSupport.mode.requiresEngine} engine, but kernel line "${kernel.id}" uses the ${kernel.engine} engine.`,
      );
    }
  }

  const imageVariant = resolveVariant(form.imageVariant, profile.overlay.defaultMb);
  const imageType = imageTypeForVariant(imageVariant);

  // Modes are declarative input; resolving them may reject the form (400) or
  // report an unsatisfied requirement / exclusivity violation (409 via the
  // route's conflict handling).
  const modeResolution = resolveModes({
    basePreset: form.basePreset,
    overlays: form.modes ?? [],
    network: form.network,
    hostname: form.hostname,
    baseVersion: context.baseVersion,
    feedCommit: context.feedCommit,
    targetId: target.id,
    architecture: target.architecture,
    imageVariant,
    engine: kernel.engine,
    capabilities: profile.capabilities,
    lanIp: form.lanIp,
    netmask: form.netmask,
  });
  if (modeResolution.issues.length > 0) {
    return { ok: false, status: 400, issues: modeResolution.issues };
  }

  const catalogProfile = context.catalogProfiles.find((item) => item.id === profile.id);
  const profileForPlan: CatalogProfile = catalogProfile
    ? {
        ...catalogProfile,
        formats: catalogProfile.formats.includes(imageType)
          ? catalogProfile.formats
          : [imageType, ...catalogProfile.formats],
      }
    : { id: profile.id, title: profile.title, formats: [imageType], imageCount: 0 };

  // The V1 composer stays the single implementation of package resolution,
  // compliance, downloads and UCI output (ticket 03 keeps V1 intact).
  const basePlan = (await createBuildPlan({ ...form, imageType }, {
    baseVersion: context.baseVersion,
    feedCommit: context.feedCommit,
    sourceNote: context.sourceNote,
    sourcePins: context.sourcePins,
    profile: profileForPlan,
    lookup: context.lookup,
    lookupAll: context.lookupAll,
    hashPassword: context.hashPassword,
    now: context.now,
  })) as BuildPlanV1;

  const sources = context.sources ?? EMPTY_SOURCE_REGISTRY;
  const request = {
    target: target.id,
    kernelLine: kernel.id,
    abi: context.sourcePins?.kernel?.vermagic ?? null,
  };
  const strategyConflicts: BuildConflict[] = [];
  const resolved = basePlan.resolved.map((entry) => {
    if (!entry.packageSource) {
      strategyConflicts.push({
        names: [entry.name],
        message: `Package "${entry.name}" has no registered package source (unknown), so the V2 planner cannot select an acquisition strategy.`,
      });
      return {
        ...entry,
        requestedStrategy: "prebuilt" as const,
        effectiveStrategy: "blocked" as const,
        fallbackReason: "package is not in the active catalog snapshot",
      };
    }

    const record = sources.lookup(entry.name, { ...request, source: entry.packageSource });
    const decision = decideStrategy(record, request);
    if (decision.effectiveStrategy === "blocked") {
      strategyConflicts.push({
        names: [entry.name],
        message: `Package "${entry.name}" (${entry.packageSource}) cannot be acquired: ${decision.fallbackReason ?? "the source registry blocks it"}.`,
      });
    }
    return { ...entry, ...decision };
  });

  const conflicts = [...basePlan.conflicts, ...strategyConflicts, ...modeResolution.conflicts];
  const engine: BuildEngine = kernel.engine;

  const plan: BuildPlanV2 = {
    ...basePlan,
    schemaVersion: 2,
    channel: context.channel ?? "release",
    target: {
      id: target.id,
      architecture: target.architecture,
      subtarget: target.subtarget,
      title: target.title,
    },
    deviceProfile: {
      targetId: target.id,
      id: profile.id,
      title: profile.title,
      capabilities: [...profile.capabilities],
    },
    kernelLine: {
      id: kernel.id,
      version: kernel.version,
      engine: kernel.engine,
      ...(kernel.sourceRecipeRef ? { sourceRecipeRef: kernel.sourceRecipeRef } : {}),
    },
    imageVariant,
    basePreset: { id: form.basePreset ?? "minimal", layer: "file/board" },
    overlays,
    modes: modeResolution.state,
    files: [...basePlan.files, ...modeResolution.files],
    engine,
    artifactName: artifactNameV2({
      baseVersion: context.baseVersion,
      targetId: target.id,
      profileId: profile.id,
      imageVariant,
    }),
    resolved,
    conflicts,
  };

  return { ok: true, plan, conflicts };
}
