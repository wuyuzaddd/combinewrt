import { variantForImageType } from "../build/artifact-name";
import { toLookupEntry } from "../build/lookup";
import { createBuildPlanV2 } from "../build/plan-v2";
import { resolveChannel } from "../build/channel";
import { createBaseVersionStore } from "../base/store";
import { hashRootPassword } from "../build/password";
import { themeMediaUrl } from "../build/uci";
import type { BuildConflict, BuildFormInput, BuildFormInputV2 } from "../build/types";
import { loadCapabilities } from "../catalog/capabilities";
import { createCatalogStore } from "../catalog/store";
import { loadImageFeedConfig } from "../config";
import { resolvePlanDllkidsPin } from "../catalog/refresh-active";
import { getDatabase } from "../db";
import type { BuildPlanV2 } from "../domain/build-plan";
import { loadSourceRegistry } from "../sources/registry";
import type { SourceRegistry } from "../sources/types";
import { extensionLookupEntry } from "../extension/lookup";
import { loadExtensionBundles } from "../extension/bundles";
import { loadCommonPreset, CommonPresetError } from "../presets/common";

/**
 * Implicit V2 defaults for a submission from the legacy V1 form (ADR 0009
 * ruling 3). The V1 form has no target/kernel-line/variant triple, so it gets
 * the one V2 build the product models for x86/64; `imageType` only selects the
 * image variant and is not carried as a planner input.
 */
export const LEGACY_V2_DEFAULTS = {
  target: "x86/64",
  profile: "generic",
  kernelLine: "6.12",
  basePreset: "minimal",
  visibility: "private",
} as const;

/**
 * Map a V1 form onto the V2 form. The V1 profile is validated against the
 * catalog before this runs (400 semantics are preserved), then pinned to the
 * V2 default profile because the capability registry only models `generic` on
 * `x86/64`.
 */
export function legacyBuildFormToV2Form(form: BuildFormInput): BuildFormInputV2 {
  return {
    profile: LEGACY_V2_DEFAULTS.profile,
    target: LEGACY_V2_DEFAULTS.target,
    kernelLine: LEGACY_V2_DEFAULTS.kernelLine,
    imageVariant: variantForImageType(form.imageType),
    basePreset: LEGACY_V2_DEFAULTS.basePreset,
    modes: [],
    hostname: form.hostname,
    timezone: form.timezone,
    lanIp: form.lanIp,
    netmask: form.netmask,
    rootPassword: form.rootPassword,
    packages: form.packages,
    ...(form.theme ? { theme: form.theme } : {}),
    ...(form.removePackages ? { removePackages: form.removePackages } : {}),
    ...(form.packagePins ? { packagePins: form.packagePins } : {}),
    visibility: form.visibility ?? LEGACY_V2_DEFAULTS.visibility,
  };
}

export type PreparedPlan = PreparedPlanV2;

/**
 * V1 form entry point. It keeps the V1 catalog checks (unknown profile /
 * unavailable image type stay 400) and then produces a V2 plan through the same
 * composer as the V2 form, so no new submission is written as schemaVersion 1.
 */
export async function preparePlanForForm(form: BuildFormInput): Promise<PreparedPlan> {
  const store = createCatalogStore(getDatabase());
  const snapshot = store.getActiveSnapshot();
  if (!snapshot) {
    return { ok: false, status: 409, body: { ok: false, error: "no active catalog snapshot" } };
  }

  const profile = store.listProfiles(snapshot.id).find((item) => item.id === form.profile);
  if (!profile) {
    return { ok: false, status: 400, body: { ok: false, issues: [`profile: unknown profile ${form.profile}`] } };
  }
  if (!profile.formats.includes(form.imageType)) {
    return {
      ok: false,
      status: 400,
      body: { ok: false, issues: [`imageType: ${form.imageType} is not available for ${profile.id}`] },
    };
  }

  return preparePlanV2ForForm(legacyBuildFormToV2Form(form));
}

/**
 * Catalog lookup with the extension registry as a fallback: extension packages
 * are not part of a catalog snapshot, their identity comes from the pinned
 * registry ref (ticket 12).
 */
export function extensionAwareLookup(
  registry: SourceRegistry,
  catalogLookup: (name: string) => ReturnType<typeof toLookupEntry> | null,
  catalogLookupAll: (name: string) => ReturnType<typeof toLookupEntry>[],
) {
  /**
   * A catalog package whose dependency can only come from our extension feeds is
   * a broken pair when mixed: e.g. dllkids' luci-app-quickstart bundles the same
   * static assets that our quickstart core ships, so installing both collides on
   * dozens of files (`trying to overwrite ... owned by quickstart`). When an
   * extension twin of the *same* package exists, it comes from one build with
   * its dependencies, so prefer the twin instead of mixing two builds.
   */
  function dependsOnExtensionOnly(entry: ReturnType<typeof toLookupEntry>): boolean {
    return entry.depends.some((raw) => {
      const dependency = raw.replace(/[<>=~].*$/, "").trim();
      if (!dependency) return false;
      if (catalogLookup(dependency)) return false;
      return registry.lookup(dependency, { source: "extension" }) !== null;
    });
  }

  function extensionTwin(name: string): ReturnType<typeof toLookupEntry> | null {
    const record = registry.lookup(name, { source: "extension" });
    return record ? extensionLookupEntry(record) : null;
  }

  return {
    lookup: (name: string) => {
      const fromCatalog = catalogLookup(name);
      const twin = fromCatalog ? extensionTwin(name) : null;
      if (fromCatalog && twin && dependsOnExtensionOnly(fromCatalog)) return twin;
      if (fromCatalog) return fromCatalog;
      return extensionTwin(name);
    },
    lookupAll: (name: string) => {
      const candidates = catalogLookupAll(name);
      const twin = extensionTwin(name);
      if (!twin) return candidates;
      const coherent = candidates.some((candidate) => dependsOnExtensionOnly(candidate));
      return coherent ? [twin, ...candidates] : [...candidates, twin];
    },
  };
}

/**
 * Deterministic file-owner clashes between packages from different builds.
 * apk fails the image install with "trying to overwrite <path> owned by <pkg>",
 * which costs a full ImageBuilder run; surfacing it as a plan conflict lets the
 * UI reject the combination in a second instead.
 */
const FILE_OWNER_CLASHES: ReadonlyArray<{ packages: readonly string[]; message: string }> = [
  {
    packages: ["luci-app-mosdns", "mosdns"],
    message:
      "luci-app-mosdns 与官方 mosdns 都安装 /etc/init.d/mosdns 和 /etc/config/mosdns，镜像安装阶段必然报 trying to overwrite；" +
      "请去掉 luci-app-mosdns（自建面板去掉 init 脚本后才会恢复可选）。",
  },
];

function knownFileOwnerConflicts(packages: readonly string[]): BuildConflict[] {
  const selected = new Set(packages.map((name) => name.split("/").pop()?.replace(/@.*$/, "") ?? name));
  return FILE_OWNER_CLASHES.filter((clash) => clash.packages.every((name) => selected.has(name))).map((clash) => ({
    names: [...clash.packages],
    message: clash.message,
  }));
}

export type PreparedPlanV2 =
  | { ok: true; plan: BuildPlanV2; conflicts: BuildConflict[] }
  | { ok: false; status: number; body: Record<string, unknown> };

/** V2 counterpart of `preparePlanForForm`; never used for V1 plan requests. */
export async function preparePlanV2ForForm(form: BuildFormInputV2): Promise<PreparedPlanV2> {
  // Installing themes and applying one are separate choices: `theme` names the
  // one applied at first boot and must be a luci-theme-* package that is also
  // being installed. The value becomes a derived media URL, never raw UCI.
  const requestedTheme = form.theme?.trim() || null;
  if (requestedTheme && !themeMediaUrl(requestedTheme)) {
    return {
      ok: false,
      status: 400,
      body: { ok: false, issues: [`theme: "${requestedTheme}" is not a luci-theme-* package name`] },
    };
  }
  if (requestedTheme && !form.packages.includes(requestedTheme)) {
    return {
      ok: false,
      status: 409,
      body: {
        ok: false,
        issues: [`theme: the default theme "${requestedTheme}" must also be selected in packages`],
      },
    };
  }

  const db = getDatabase();
  const store = createCatalogStore(db);
  const active = store.getActiveSnapshot();
  // The Simple form offers release-channel base versions. A request that names
  // another release uses that release's newest catalog snapshot; the active
  // snapshot stays the default when no baseVersion is sent.
  let snapshot = active;
  if (form.baseVersion && form.baseVersion !== active?.baseVersion) {
    const snapshotId = store.latestForBaseVersion(form.baseVersion);
    const requested = snapshotId === null ? null : store.getSnapshot(snapshotId);
    if (!requested) {
      return {
        ok: false,
        status: 409,
        body: {
          ok: false,
          issues: [`baseVersion: no catalog snapshot is available for release ${form.baseVersion}`],
        },
      };
    }
    snapshot = requested;
  }
  if (!snapshot) {
    return { ok: false, status: 409, body: { ok: false, error: "no active catalog snapshot" } };
  }

  let commonPreset;
  try {
    commonPreset = loadCommonPreset();
  } catch (error) {
    if (error instanceof CommonPresetError) {
      return { ok: false, status: 500, body: { ok: false, error: error.message } };
    }
    throw error;
  }

  const registry = loadSourceRegistry();
  const lookup = extensionAwareLookup(
    registry,
    (name) => {
      const pkg = store.getPackage(snapshot.id, name);
      return pkg ? toLookupEntry(pkg) : null;
    },
    (name) => store.getPackageCandidates(snapshot.id, name).map(toLookupEntry),
  );

  let bundles;
  try {
    bundles = loadExtensionBundles({ registry });
  } catch (error) {
    return {
      ok: false,
      status: 500,
      body: { ok: false, error: error instanceof Error ? error.message : String(error) },
    };
  }

  // ADR 0009 ruling 1, per plan: a resolved catalog snapshot is already built
  // from an adopted pin, and its package entries carry that pin. Using the live
  // DB pin here would make the plan pin disagree with the snapshot's entries
  // (the composition check then hard-blocks the preview). The snapshot pin wins;
  // the live DB pin / configured seed is only a fallback for a snapshot with no
  // dllkids pin at all.
  const feedConfig = loadImageFeedConfig();
  const dllkidsPin = resolvePlanDllkidsPin(db, feedConfig, snapshot.sourcePins.dllkids);
  const sourcePins = { ...snapshot.sourcePins, dllkids: dllkidsPin.value };

  // Ticket 11: the channel is a property of the selected BaseVersion row, not
  // of the form. A row missing from `base_versions` (an old snapshot base)
  // falls back to the version shape inside the planner.
  const baseRecord = createBaseVersionStore(db).get(snapshot.baseVersion);

  const outcome = await createBuildPlanV2(form, {
    baseVersion: snapshot.baseVersion,
    channel: resolveChannel(snapshot.baseVersion, baseRecord),
    feedCommit: snapshot.feedCommit,
    sourceNote: snapshot.sourceNote,
    sourcePins,
    dllkidsPinSource: dllkidsPin.source,
    feedOptions: { ...feedConfig, dllkidsIndexSha256: dllkidsPin.value },
    catalogProfiles: store.listProfiles(snapshot.id),
    commonPreset,
    capabilities: loadCapabilities(),
    sources: registry,
    bundles,
    lookup: lookup.lookup,
    lookupAll: lookup.lookupAll,
    hashPassword: (password) => hashRootPassword(password),
  });

  if (!outcome.ok) {
    return { ok: false, status: outcome.status, body: { ok: false, issues: outcome.issues } };
  }
  const clashConflicts = knownFileOwnerConflicts([
    ...outcome.plan.packages,
    ...(outcome.plan.resolved ?? []).map((entry) => entry.name),
  ]);
  if (clashConflicts.length > 0) {
    outcome.plan.conflicts.push(...clashConflicts);
    outcome.conflicts.push(...clashConflicts);
  }
  return { ok: true, plan: outcome.plan, conflicts: outcome.conflicts };
}
