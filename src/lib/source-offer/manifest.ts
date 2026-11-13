import type { BaseVersion } from "../base/types";
import type { BuildConfig, BuildPlan, AppliedPatch } from "../build/types";
import type { BuildRecord } from "../builds/types";
import { EMPTY_SOURCE_PINS, type SourcePins } from "../catalog/types";
import { createComplianceReport, type ComplianceReport } from "../compliance";

export interface SourceOfferPackage {
  name: string;
  version: string | null;
  source: string | null;
  sourcePin: string | null;
  sha256: string | null;
  feed: string | null;
  license: string | null;
  proprietary: boolean;
}

export interface SourceOfferManifest {
  schemaVersion: 1;
  build: {
    id: string;
    status: string;
    runId: string | null;
    createdAt: string;
    artifactName: string;
    profileId: string;
    profileTitle: string;
    imageType: string;
  };
  openwrtTag: string;
  baseVersion: string;
  imageBuilder: { url: string; sha256: string } | null;
  sourcePins: SourcePins;
  packages: SourceOfferPackage[];
  patches: AppliedPatch[];
  config: BuildConfig | null;
  generatedFiles: string[];
  compliance: ComplianceReport;
  notes: string[];
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
    compliance,
    notes: [
      "This manifest is the GPL source offer for the pinned package sources used by this image.",
      "No firmware or third-party source code is published by this repository; dllkids is referenced by URL and sha256 only.",
      "Root password hashes and generated file contents are deliberately omitted.",
    ],
  };
}

export function sourceOfferJson(offer: SourceOfferManifest): string {
  return `${JSON.stringify(offer, null, 2)}\n`;
}
