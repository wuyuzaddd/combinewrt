import type { BaseVersion } from "../base/types";
import { imageTypeForPlan } from "../build/artifact-name";
import type { ImageFeedSet } from "../build/feeds";
import type { AppliedMode, BuildConfig, BuildConfigV2, BuildPlan, AppliedPatch, BuildVisibility } from "../build/types";
import type { BuildRecord, BuildStatus } from "../builds/types";
import {
  EMPTY_SOURCE_PINS,
  type ImageFormatId,
  type PackageSource,
  type SourcePins,
} from "../catalog/types";
import type {
  BaseChannel,
  BuildEngine,
  DeviceProfile,
  ImageVariant,
  KernelLine,
  Target,
} from "../domain/types";
import { createComplianceReport, type ComplianceReport } from "../compliance";

export interface SourceOfferPackage {
  name: string;
  version: string | null;
  source: PackageSource | null;
  sourcePin: string | null;
  sha256: string | null;
  feed: string | null;
  license: string | null;
  proprietary: boolean;
  /** V2 acquisition strategy (absent on V1 offers). */
  strategy?: {
    requested: string;
    effective: string;
    fallbackReason: string | null;
  };
}

export interface SourceOfferModeSummary {
  id: string;
  layer: AppliedMode["layer"];
  title: string;
  experimental: boolean;
}

/**
 * Mode labels and generated paths only. The typed network section (which may
 * contain PPPoE credentials) and the HTTPS secret spec are deliberately not
 * part of the source offer; the manifest is public by design.
 */
export interface SourceOfferModes {
  basePreset: SourceOfferModeSummary;
  overlays: SourceOfferModeSummary[];
  experimental: string[];
  generatedFiles: string[];
}

/**
 * The feed set as published: every repository URL, its enablement condition,
 * the index pin and the key fingerprint. Generated file contents (and any
 * private key material) are deliberately excluded.
 */
export type SourceOfferFeedSet = Omit<ImageFeedSet, "files">;

/**
 * The V2 build composition (ticket 15). Everything the V1 offer already carried
 * stays top-level; this section adds the V2-only axes. It deliberately excludes
 * the typed network state (which may hold PPPoE credentials) and the secret spec.
 */
export interface SourceOfferV2 {
  engine: BuildEngine;
  channel: BaseChannel;
  target: Target;
  deviceProfile: DeviceProfile;
  kernelLine: KernelLine;
  imageVariant: ImageVariant;
  basePreset: SourceOfferModeSummary;
  overlays: SourceOfferModeSummary[];
  strategies: Array<{
    name: string;
    source: PackageSource | null;
    requested: string;
    effective: string;
    fallbackReason: string | null;
  }>;
}

export interface SourceOfferManifest {
  schemaVersion: 1;
  build: {
    id: string;
    status: BuildStatus;
    runId: string | null;
    createdAt: string;
    artifactName: string;
    profileId: string;
    profileTitle: string;
    imageType: ImageFormatId;
  };
  openwrtTag: string;
  baseVersion: string;
  imageBuilder: { url: string; sha256: string } | null;
  sourcePins: SourcePins;
  /** Image feed set (ticket 09); null for plans written before it existed. */
  feedSet: SourceOfferFeedSet | null;
  packages: SourceOfferPackage[];
  patches: AppliedPatch[];
  config: BuildConfig | BuildConfigV2 | null;
  generatedFiles: string[];
  modes?: SourceOfferModes;
  /** Present only for `schemaVersion: 2` plans. V1 offers stay unchanged. */
  v2?: SourceOfferV2;
  compliance: ComplianceReport;
  visibility: BuildVisibility;
  publicDistribution: boolean;
  notes: string[];
}

function summarizeMode(mode: AppliedMode): SourceOfferModeSummary {
  return { id: mode.id, layer: mode.layer, title: mode.title, experimental: mode.experimental };
}

export function distributionLabel(
  visibility: BuildVisibility,
  publicEligible: boolean,
): string {
  if (visibility === "private") return "自用（未公开分发）";
  return publicEligible ? "允许公开分发" : "不得作为公开镜像发布";
}

export function createSourceOffer(
  build: BuildRecord,
  options: { imageBuilder?: BaseVersion | null } = {},
): SourceOfferManifest {
  const plan: BuildPlan = build.plan;
  const imageBuilder = options.imageBuilder
    ? { url: options.imageBuilder.imageBuilderUrl, sha256: options.imageBuilder.imageBuilderSha256 }
    : null;
  const compliance = plan.compliance ?? createComplianceReport(plan.resolved);
  const visibility = plan.visibility ?? "private";
  const publicDistribution = visibility === "public" && compliance.publicEligible;
  const modeSummary: SourceOfferModes | undefined =
    plan.schemaVersion === 2 && plan.modes
      ? {
          basePreset: summarizeMode(plan.modes.basePreset),
          overlays: plan.modes.overlays.map(summarizeMode),
          experimental: [...plan.modes.experimental],
          generatedFiles: [...plan.modes.generatedFiles],
        }
      : undefined;
  const feedSet: SourceOfferFeedSet | null =
    plan.schemaVersion === 2 && plan.feedSet
      ? {
          visibility: plan.feedSet.visibility,
          baseVersion: plan.feedSet.baseVersion,
          targetId: plan.feedSet.targetId,
          feedTarget: plan.feedSet.feedTarget,
          officialBaseUrl: plan.feedSet.officialBaseUrl,
          officialMirror: plan.feedSet.officialMirror,
          officialRepositories: [...plan.feedSet.officialRepositories],
          key: { ...plan.feedSet.key },
          // ADR 0009 ruling 1: `plan.sourcePins.dllkids` is the single
          // authority. Deriving the published dllkids pin from it here means an
          // offer can never disagree with the plan, even for a plan written
          // before the planner stopped stamping the config seed.
          repositories: plan.feedSet.repositories.map((repository) =>
            repository.id === "dllkids" && plan.sourcePins?.dllkids
              ? { ...repository, indexSha256: plan.sourcePins.dllkids }
              : { ...repository },
          ),
        }
      : null;
  // V2 plans are only rendered as V2 when the composition axes exist; a
  // partially-written V2 row still keeps the V1 offer shape readable.
  const v2Base =
    plan.schemaVersion === 2
      ? modeSummary?.basePreset
        ? modeSummary.basePreset
        : plan.modes?.basePreset
          ? summarizeMode(plan.modes.basePreset)
          : plan.basePreset
            ? summarizeMode({
                ...plan.basePreset,
                title: plan.basePreset.title ?? plan.basePreset.id,
                experimental: false,
              })
            : summarizeMode({ id: "minimal", layer: "file/board", title: "Minimal", experimental: false })
      : null;
  const v2: SourceOfferV2 | undefined =
    plan.schemaVersion === 2 && plan.target && plan.kernelLine && plan.imageVariant && plan.engine
      ? {
          engine: plan.engine,
          channel: plan.channel,
          target: plan.target,
          deviceProfile: plan.deviceProfile,
          kernelLine: plan.kernelLine,
          imageVariant: plan.imageVariant,
          basePreset: v2Base as SourceOfferModeSummary,
          overlays:
            modeSummary?.overlays ??
            (plan.overlays ?? []).map((overlay) =>
              summarizeMode({
                id: overlay.id,
                layer: overlay.layer,
                title: overlay.title ?? overlay.id,
                experimental: false,
              }),
            ),
          strategies: plan.resolved.map((entry) => ({
            name: entry.name,
            source: entry.packageSource,
            requested: entry.requestedStrategy ?? "prebuilt",
            effective: entry.effectiveStrategy ?? entry.requestedStrategy ?? "prebuilt",
            fallbackReason: entry.fallbackReason ?? null,
          })),
        }
      : undefined;

  const notes = [
    "This manifest is the GPL source offer for the pinned package sources used by this image.",
    "No firmware or third-party source code is published by this repository; dllkids is referenced by URL and sha256 only.",
    "Root password hashes and generated file contents are deliberately omitted.",
  ];
  notes.push(
    visibility === "private"
      ? "Distribution conclusion: this image is marked private and is not offered for public distribution."
      : publicDistribution
        ? "Distribution conclusion: this image is marked public and every package passed the license gate."
        : "Distribution conclusion: this image is marked public but contains packages that may not be publicly distributed.",
  );
  if (!plan.sourcePins) {
    notes.push("Legacy build: source pins were not captured in this plan; treat the pin list as incomplete.");
  }
  if (!plan.compliance) {
    notes.push("Legacy build: license metadata was not captured; compliance is marked conservatively.");
  }
  if (!imageBuilder) {
    notes.push("The active base-version record no longer exists; the ImageBuilder checksum is unavailable.");
  }
  if (modeSummary) {
    notes.push(
      "Mode network settings, PPPoE credentials and the HTTPS private key are deliberately omitted from this manifest.",
    );
  }
  if (v2) {
    notes.push(
      "V2 composition: engine, target/profile, kernel line, image variant, mode stack and per-package acquisition strategy are recorded; typed network credentials and the HTTPS private key are omitted.",
    );
  }
  if (feedSet) {
    notes.push(
      "Image feed set: ImageBuilder's distfeeds.list keeps the official ImmortalWrt feeds; project supplement/extension feeds are version-frozen and signed with the recorded key. No private keys or credentials are included.",
    );
    const dllkidsRepository = feedSet.repositories.find((repository) => repository.id === "dllkids");
    if (dllkidsRepository) {
      notes.push(
        "The dllkids feed is unsigned and reachable only through the explicit apk-dllkids wrapper; it is recorded by URL and sha256 without a key fingerprint.",
      );
      if (dllkidsRepository.indexSha256Source === "config-seed") {
        notes.push(
          "dllkids pin authority: no adopted database pin exists yet, so the configured first-install seed is recorded. The source watch adopts the live pin automatically; the database pin wins once it exists (ADR 0009 ruling 1).",
        );
      }
    }
  }

  return {
    schemaVersion: 1,
    build: {
      id: build.id,
      status: build.status,
      runId: build.runId,
      createdAt: build.createdAt,
      artifactName: plan.artifactName,
      profileId: plan.profileId,
      profileTitle: plan.profileTitle,
      // V1-compatible offer field: derived from the variant for V2 plans.
      imageType: imageTypeForPlan(plan),
    },
    openwrtTag: `v${plan.baseVersion}`,
    baseVersion: plan.baseVersion,
    imageBuilder,
    sourcePins: plan.sourcePins ?? EMPTY_SOURCE_PINS,
    feedSet,
    packages: plan.resolved.map((entry) => ({
      name: entry.name,
      version: entry.version,
      source: entry.packageSource,
      sourcePin: entry.sourcePin,
      sha256: entry.sha256,
      feed: entry.feed,
      license: entry.license ?? null,
      proprietary: entry.proprietary ?? false,
      ...(entry.requestedStrategy
        ? {
            strategy: {
              requested: entry.requestedStrategy,
              effective: entry.effectiveStrategy ?? entry.requestedStrategy,
              fallbackReason: entry.fallbackReason ?? null,
            },
          }
        : {}),
    })),
    // Patch contents are not embedded because the manifest is served from the
    // site; the repository path is the authoritative copy.
    patches: plan.patches ?? [],
    // V2 rows hold the portable snapshot; the manifest keeps the bare config shape.
    config: ((build.config && "format" in build.config && build.config.format === "combinewrt-build"
      ? build.config.config
      : build.config) ?? plan.config ?? null) as unknown as BuildConfig | null,
    generatedFiles: plan.files.map((file) => file.path),
    ...(modeSummary ? { modes: modeSummary } : {}),
    ...(v2 ? { v2 } : {}),
    compliance,
    visibility,
    publicDistribution,
    notes,
  };
}

export function sourceOfferJson(offer: SourceOfferManifest): string {
  return `${JSON.stringify(offer, null, 2)}\n`;
}
