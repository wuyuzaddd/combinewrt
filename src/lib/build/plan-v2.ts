import type { BuildPlanV1, BuildPlanV2 } from "../domain/build-plan";
import { CapabilityError, getKernelLine, getProfile, getTarget, loadCapabilities, supportsMode, supportsVariant, type CapabilityRegistry } from "../catalog/capabilities";
import type { CatalogProfile, SourcePins } from "../catalog/types";
import type { BaseChannel, BuildEngine } from "../domain/types";
import { resolveImageVariant } from "../image/variants";
import { EMPTY_SOURCE_REGISTRY } from "../sources/registry";
import { decideStrategy } from "../sources/strategy";
import type { SourceRegistry } from "../sources/types";
import { commonPackageSelectionConflicts, type CommonPreset } from "../presets/common";
import { expandBundleTokens } from "../extension/bundles";
import type { ExtensionBundle } from "../extension/types";
import { artifactNameV2, imageTypeForVariant } from "./artifact-name";
import {
  DEFAULT_DLLKIDS_INDEX_SHA256,
  buildImageFeedSet,
  createImagePreflight,
  type IndexSha256Source,
  type ResolvedImageFeedOptions,
} from "./feeds";
import { resolveModes } from "./modes";
import { createBuildPlan } from "./plan";
import { parsePackageRef } from "./refs";
import { applyPackageRemovals, findRemovalDependencyConflicts } from "./removal";
import type {
  BuildConflict,
  BuildFormInputV2,
  PackageLookup,
  PackageLookupAll,
  RequestedPackage,
} from "./types";

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
  /** Curated common package registry (ticket 08); enables applicability checks. */
  commonPreset?: CommonPreset;
  /** Curated one-click bundles (ticket 12); `bundle:<id>` requests expand to plain packages. */
  bundles?: readonly ExtensionBundle[];
  /** Project feed configuration (ticket 09); defaults to the checked-in values. */
  feedOptions?: Partial<ResolvedImageFeedOptions>;
  /**
   * Authority of the dllkids pin carried in `sourcePins` (ticket 10). When the
   * caller resolved the pin from `source_pins` it passes `database`; when it
   * fell back to the configured seed it passes `config-seed`. Defaults to
   * `database` when `sourcePins.dllkids` is present.
   */
  dllkidsPinSource?: IndexSha256Source;
  hashPassword: (password: string) => Promise<string>;
  now?: Date;
}

export interface PlanV2Success {
  ok: true;
  plan: BuildPlanV2;
  conflicts: BuildConflict[];
}

/**
 * A form the capability registry refuses. Most refusals are malformed requests
 * (400); naming a kernel line the product does not model at all is a
 * deliberate "this build cannot be supported" answer (409), matching the
 * ticket 06 contract.
 */
export interface PlanV2Failure {
  ok: false;
  status: 400 | 409;
  issues: string[];
}

export type PlanV2Outcome = PlanV2Success | PlanV2Failure;

function reject(issue: string, status: 400 | 409 = 400): PlanV2Failure {
  return { ok: false, status, issues: [issue] };
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
    if (error instanceof CapabilityError) {
      return reject(error.message, error.code === "unknown-kernel-line" ? 409 : 400);
    }
    throw error;
  }

  const sources = context.sources ?? EMPTY_SOURCE_REGISTRY;

  // `bundle:<id>` requests are the one-click path: they expand into the same
  // plain package list the rest of the composer already understands, so the
  // licence gate, kmod ABI checks and feed preflight apply unchanged.
  const bundleExpansion = (context.bundles ?? []).length
    ? expandBundleTokens(form.packages, { bundles: context.bundles ?? [], registry: sources, targetId: target.id })
    : { packages: [...form.packages], bundles: [], conflicts: [] };
  const expandedForm: BuildFormInputV2 = { ...form, packages: bundleExpansion.packages };

  const variantSupport = supportsVariant({ targetId: target.id, id: profile.id }, kernel.id, form.imageVariant, registry);
  if (!variantSupport.supported) return reject(variantSupport.reason.message);

  const overlays = form.modes ?? [];
  for (const mode of overlays) {
    const modeSupport = supportsMode({ targetId: target.id, id: profile.id }, mode.id, registry);
    if (!modeSupport.supported) return reject(modeSupport.reason.message);
    // Engine/filesystem/artifact requirements are declarative tokens: an
    // unsatisfied one is a 409-grade conflict naming the requirement (ticket
    // 08), not a 400 from the capability registry.
  }

  const imageVariant = resolveImageVariant(form.imageVariant, profile.overlay.defaultMb);
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
    // Normalise source prefixes / pins so a `conflicts: ["package:podman"]`
    // token matches `official/podman` too (ticket 08).
    packages: expandedForm.packages.map((raw) => parsePackageRef(raw)?.name ?? raw),
    lanIp: form.lanIp,
    netmask: form.netmask,
  });
  if (modeResolution.issues.length > 0) {
    return { ok: false, status: 400, issues: modeResolution.issues };
  }

  // Negative package list + mode package sets (ticket 08). The V1 composer
  // receives the already-filtered positive list with `removePackages` cleared,
  // so removal semantics live in exactly one place per planner.
  const parsedRequested = expandedForm.packages
    .map(parsePackageRef)
    .filter((item): item is RequestedPackage => item !== null);
  const removal = applyPackageRemovals({
    requested: parsedRequested,
    removals: form.removePackages ?? [],
    modePackages: modeResolution.packageOwners,
  });
  const removedNames = new Set(removal.removed);
  const selectedPackages = expandedForm.packages.filter((raw) => {
    const reference = parsePackageRef(raw);
    return !reference || !removedNames.has(reference.name);
  });
  const effectivePackages = [...new Set([...selectedPackages, ...modeResolution.packages])];

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
  const basePlan = (await createBuildPlan({ ...expandedForm, imageType, packages: effectivePackages, removePackages: [] }, {
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

  // Extension entries are pinned to a 40-hex upstream ref in the registry; a
  // plan may not silently build from a different commit (ticket 12).
  const extensionPinConflicts: BuildConflict[] = [];
  for (const entry of resolved) {
    if (entry.packageSource !== "extension") continue;
    const record = sources.lookup(entry.name, { source: "extension" });
    if (!record) {
      extensionPinConflicts.push({
        names: [entry.name],
        message: `Extension package "${entry.name}" is not in the source registry, so it cannot be acquired.`,
      });
      continue;
    }
    const ref = record.ref ?? record.pin ?? null;
    if (!ref || entry.sourcePin !== ref) {
      extensionPinConflicts.push({
        names: [entry.name],
        message: `Extension package "${entry.name}" is pinned to ${entry.sourcePin ?? "no ref"}, but the registry pins ${ref ?? "no ref"}.`,
      });
    }
  }

  // Public/private rule (ticket 12, spec "Public vs private images"): a package
  // whose registry entry is not publicAllowed may only appear in a private
  // plan. The conflict names the package and its source, which turns into the
  // 409 the plan route returns.
  const visibility = basePlan.visibility ?? "private";
  const publicAllowedConflicts: BuildConflict[] = [];
  if (visibility === "public") {
    for (const entry of resolved) {
      if (!entry.packageSource) continue;
      const record =
        sources.lookup(entry.name, { source: entry.packageSource }) ??
        sources.lookup(entry.name);
      if (!record) {
        if (entry.packageSource !== "official") {
          publicAllowedConflicts.push({
            names: [entry.name],
            message: `Package "${entry.name}" (${entry.packageSource}) is not in the source registry, so a public image cannot include it.`,
          });
        }
        continue;
      }
      if (record.publicAllowed !== true) {
        const origin = record.repo ?? record.pin ?? "unregistered upstream";
        publicAllowedConflicts.push({
          names: [entry.name],
          message: `Package "${entry.name}" (${entry.packageSource}) is not publicAllowed (source: ${origin}); public images need private visibility.`,
        });
      }
    }
  }

  // A mode package that is a kmod must resolve to official and match the ABI
  // the source registry recorded for this kernel line (ticket 08).
  const modePackageNames = new Set(modeResolution.packages);
  const modePackageConflicts: BuildConflict[] = [];
  for (const entry of resolved) {
    if (!modePackageNames.has(entry.name) || !entry.name.startsWith("kmod-")) continue;
    if (entry.packageSource !== "official") {
      modePackageConflicts.push({
        names: [entry.name],
        message: `Mode package "${entry.name}" is a kmod and must come from the official source, but it resolved from ${entry.packageSource ?? "unknown"}.`,
      });
      continue;
    }
    const record = sources.lookup(entry.name, { ...request, source: entry.packageSource });
    const abi = record?.abi ?? null;
    if (abi && request.abi && abi !== request.abi) {
      modePackageConflicts.push({
        names: [entry.name],
        message: `Mode package "${entry.name}" is built against kernel ABI ${abi}, but this build pins ${request.abi}.`,
      });
    }
  }

  const removalConflicts = findRemovalDependencyConflicts({
    removals: removal.removed,
    requests: parsedRequested.filter((item) => !removedNames.has(item.name)),
    entries: resolved,
    lookup: context.lookup,
  });

  const curatedConflicts: BuildConflict[] = context.commonPreset
    ? commonPackageSelectionConflicts(context.commonPreset, {
        targetId: target.id,
        kernelLine: kernel.id,
        packages: parsedRequested.filter((item) => !removedNames.has(item.name)).map((item) => item.name),
        resolvedSources: new Map(
          resolved.map((entry) => [entry.name, entry.packageSource ?? "unknown"]),
        ),
      })
    : [];

  const conflicts = [
    ...bundleExpansion.conflicts,
    ...basePlan.conflicts,
    ...strategyConflicts,
    ...extensionPinConflicts,
    ...publicAllowedConflicts,
    ...modeResolution.conflicts,
    ...removal.conflicts,
    ...removalConflicts,
    ...modePackageConflicts,
    ...curatedConflicts,
  ];
  const engine: BuildEngine = kernel.engine;
  // ADR 0009 ruling 1: `plan.sourcePins` is the single authority for the
  // dllkids sha. The feed set derives its value from it, never from
  // `loadImageFeedConfig()` directly. The config constant is the last resort
  // only when no caller supplied a pin, and that case is marked as a seed.
  const dllkidsIndexSha256 =
    context.sourcePins?.dllkids ??
    context.feedOptions?.dllkidsIndexSha256 ??
    DEFAULT_DLLKIDS_INDEX_SHA256;
  const dllkidsIndexSha256Source: IndexSha256Source = context.sourcePins?.dllkids
    ? context.dllkidsPinSource ?? "database"
    : "config-seed";
  const feedSet = buildImageFeedSet(
    {
      baseVersion: context.baseVersion,
      target,
      kernel: context.sourcePins?.kernel ?? null,
      visibility,
      resolved,
      downloads: basePlan.downloads,
      dllkidsIndexSha256Source,
    },
    { ...context.feedOptions, dllkidsIndexSha256 },
  );
  const preflight = createImagePreflight(feedSet, basePlan.packages);

  const plan: BuildPlanV2 = {
    ...basePlan,
    // Keep the plan's pin list and its feed set in agreement: one dllkids sha.
    // Public plans never carry the dllkids feed, so their pin list is left as
    // recorded by the catalog snapshot.
    sourcePins:
      visibility === "private" || context.sourcePins?.dllkids
        ? { ...basePlan.sourcePins, dllkids: dllkidsIndexSha256 }
        : basePlan.sourcePins,
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
    files: [...basePlan.files, ...modeResolution.files, ...feedSet.files],
    engine,
    feedSet,
    preflight,
    warnings: [...(basePlan.warnings ?? []), ...removal.warnings],
    kernelConfig: modeResolution.kernelConfig,
    ...(modeResolution.docker ? { docker: modeResolution.docker } : {}),
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
