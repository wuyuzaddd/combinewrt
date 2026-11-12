import { IMAGE_FORMATS } from "../catalog/profiles";
import type { CatalogProfile, SourcePins } from "../catalog/types";
import { EMPTY_SOURCE_PINS } from "../catalog/types";
import { buildDownloadManifest, collectRequests, findSourceConflicts } from "./composition";
import { findConflicts } from "./conflicts";
import { resolveDependencies } from "./resolve";
import type { BuildConflict, BuildFormInput, BuildPlan, PackageLookup, PackageLookupAll } from "./types";
import { generateUciDefaults } from "./uci";

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

export function artifactName(baseVersion: string, profileId: string, imageType: BuildFormInput["imageType"]): string {
  const format = IMAGE_FORMATS.find((item) => item.id === imageType);
  if (!format) throw new Error(`unknown image type: ${imageType}`);
  return `immortalwrt-${baseVersion}-x86-64-${profileId}${format.suffix}`;
}

export function imageBuilderCommand(profileId: string, packages: string[]): string {
  return `make -j$(nproc) image PROFILE=${profileId} PACKAGES="${packages.join(" ")}" FILES=files`;
}

export async function createBuildPlan(form: BuildFormInput, context: PlanContext): Promise<BuildPlan> {
  const formatConflicts: BuildConflict[] = [];
  const requests = collectRequests(form, formatConflicts);
  const { entries, missingDependencies } = resolveDependencies(requests, context.lookup, context.lookupAll);
  const names = entries.map((entry) => entry.name);
  const sourceConflicts = findSourceConflicts(requests, entries, context, form.packagePins ?? []);
  const downloads = buildDownloadManifest(entries, context, sourceConflicts);
  const topLevelPackages = [...new Set(requests.map((request) => request.name))];
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
    },
    baseVersion: context.baseVersion,
    feedCommit: context.feedCommit,
    sourceNote: context.sourceNote,
    sourcePins: context.sourcePins ?? EMPTY_SOURCE_PINS,
    profileId: context.profile.id,
    profileTitle: context.profile.title,
    imageType: form.imageType,
    packages: names,
    topLevelPackages,
    resolved: entries,
    downloads,
    missingDependencies,
    conflicts: [...formatConflicts, ...sourceConflicts, ...findConflicts(names)],
    files: [{ path: "files/etc/uci-defaults/99-combinewrt", content: uci, mode: 0o755 }],
    artifactName: artifactName(context.baseVersion, context.profile.id, form.imageType),
    imageBuilderCommand: imageBuilderCommand(context.profile.id, names),
    createdAt: (context.now ?? new Date()).toISOString(),
  };
}
