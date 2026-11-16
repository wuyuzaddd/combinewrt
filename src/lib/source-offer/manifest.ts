import type { BaseVersion } from "../base/types";
import type { ImageFeedSet } from "../build/feeds";
import type { AppliedMode, BuildConfig, BuildPlan, AppliedPatch, BuildVisibility } from "../build/types";
import type { BuildRecord, BuildStatus } from "../builds/types";
import {
  EMPTY_SOURCE_PINS,
  type ImageFormatId,
  type PackageSource,
  type SourcePins,
} from "../catalog/types";
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
  config: BuildConfig | null;
  generatedFiles: string[];
  modes?: SourceOfferModes;
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
          repositories: plan.feedSet.repositories.map((repository) => ({ ...repository })),
        }
      : null;
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
  if (feedSet) {
    notes.push(
      "Image feed set: ImageBuilder's distfeeds.list keeps the official ImmortalWrt feeds; project supplement/extension feeds are version-frozen and signed with the recorded key. No private keys or credentials are included.",
    );
    if (feedSet.repositories.some((repository) => repository.id === "dllkids")) {
      notes.push(
        "The dllkids feed is unsigned and reachable only through the explicit apk-dllkids wrapper; it is recorded by URL and sha256 without a key fingerprint.",
      );
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
      imageType: plan.imageType,
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
    })),
    // Patch contents are not embedded because the manifest is served from the
    // site; the repository path is the authoritative copy.
    patches: plan.patches ?? [],
    config: build.config ?? plan.config ?? null,
    generatedFiles: plan.files.map((file) => file.path),
    ...(modeSummary ? { modes: modeSummary } : {}),
    compliance,
    visibility,
    publicDistribution,
    notes,
  };
}

export function sourceOfferJson(offer: SourceOfferManifest): string {
  return `${JSON.stringify(offer, null, 2)}\n`;
}
