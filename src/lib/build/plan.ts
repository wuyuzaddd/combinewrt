import type { CatalogProfile, SourcePins } from "../catalog/types";
import { EMPTY_SOURCE_PINS } from "../catalog/types";
import { createComplianceReport } from "../compliance";
import { artifactNameV1 } from "./artifact-name";
import { buildDownloadManifest, collectRequests, findSourceConflicts } from "./composition";
import { findConflicts } from "./conflicts";
import { APPLIED_PATCHES } from "./patches";
import { applyPackageRemovals, findRemovalDependencyConflicts } from "./removal";
import { parsePackageRef } from "./refs";
import { resolveDependencies } from "./resolve";
import type {
  BuildConflict,
  BuildFormInput,
  BuildPlan,
  PackageLookup,
  PackageLookupAll,
  RequestedPackage,
} from "./types";
import { generateUciDefaults } from "./uci";
import { virtualProviderLookup } from "./virtual-providers";

export interface PlanContext {
  baseVersion: string;
  feedCommit: string;
  sourceNote: string;
  sourcePins?: SourcePins;
  profile: CatalogProfile;
  lookup: PackageLookup;
  lookupAll?: PackageLookupAll;
  hashPassword: (password: string) => Promise<string>;
  now?: Date;
}

export function imageBuilderCommand(profileId: string, packages: string[]): string {
  return `make -j$(nproc) image PROFILE=${profileId} PACKAGES="${packages.join(" ")}" FILES=files`;
}

export async function createBuildPlan(form: BuildFormInput, context: PlanContext): Promise<BuildPlan> {
  // The negative package list runs before dependency resolution, so a removal
  // never pulls its own dependencies back in (ticket 08).
  const parsedRequested = form.packages
    .map(parsePackageRef)
    .filter((item): item is RequestedPackage => item !== null);
  const removal = applyPackageRemovals({
    requested: parsedRequested,
    removals: form.removePackages ?? [],
  });
  const removedNames = new Set(removal.removed);
  const packagesAfterRemoval = form.packages.filter((raw) => {
    const reference = parsePackageRef(raw);
    return !reference || !removedNames.has(reference.name);
  });

  const formatConflicts: BuildConflict[] = [...removal.conflicts];
  const requests = collectRequests({ ...form, packages: packagesAfterRemoval }, formatConflicts);
  const { entries, missingDependencies } = resolveDependencies(
    requests,
    context.lookup,
    context.lookupAll,
    virtualProviderLookup,
  );
  const names = entries.map((entry) => entry.name);
  const sourceConflicts = findSourceConflicts(requests, entries, context, form.packagePins ?? []);
  const downloads = buildDownloadManifest(entries, context, sourceConflicts);
  const removalConflicts = findRemovalDependencyConflicts({
    removals: removal.removed,
    requests,
    entries,
    lookup: context.lookup,
  });
  const topLevelPackages = [...new Set(requests.map((request) => request.name))];
  const visibility = form.visibility ?? "private";
  const compliance = createComplianceReport(entries);
  const complianceConflicts: BuildConflict[] =
    visibility === "public" && !compliance.publicEligible
      ? [
          {
            names: compliance.issues.map((issue) => issue.name),
            message: `公开镜像不能包含不可公开分发的软件包：${compliance.issues
              .map(
                (issue) =>
                  `${issue.name} (${issue.packageSource ?? "unknown"}, ${issue.reason === "proprietary" ? "proprietary" : "unknown-license"})`,
              )
              .join("、")}`,
          },
        ]
      : [];
  const rootHash = await context.hashPassword(form.rootPassword);
  const uci = generateUciDefaults(form, rootHash, { now: context.now });

  return {
    config: {
      profile: form.profile,
      imageType: form.imageType,
      hostname: form.hostname,
      timezone: form.timezone,
      lanIp: form.lanIp,
      netmask: form.netmask,
      packages: names,
      visibility,
    },
    baseVersion: context.baseVersion,
    feedCommit: context.feedCommit,
    sourceNote: context.sourceNote,
    sourcePins: context.sourcePins ?? EMPTY_SOURCE_PINS,
    profileId: context.profile.id,
    profileTitle: context.profile.title,
    imageType: form.imageType,
    visibility,
    packages: names,
    topLevelPackages,
    resolved: entries,
    downloads,
    missingDependencies,
    conflicts: [
      ...formatConflicts,
      ...sourceConflicts,
      ...removalConflicts,
      ...complianceConflicts,
      ...findConflicts(names),
    ],
    warnings: removal.warnings,
    compliance,
    patches: APPLIED_PATCHES,
    files: [{ path: "files/etc/uci-defaults/99-combinewrt", content: uci, mode: 0o755 }],
    artifactName: artifactNameV1(form.imageType, { baseVersion: context.baseVersion, profileId: context.profile.id }),
    imageBuilderCommand: imageBuilderCommand(context.profile.id, names),
    createdAt: (context.now ?? new Date()).toISOString(),
  };
}
