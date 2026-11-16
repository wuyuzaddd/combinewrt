import { toLookupEntry } from "../build/lookup";
import { createBuildPlan } from "../build/plan";
import { createBuildPlanV2 } from "../build/plan-v2";
import { hashRootPassword } from "../build/password";
import type { BuildConflict, BuildFormInput, BuildFormInputV2 } from "../build/types";
import { loadCapabilities } from "../catalog/capabilities";
import { createCatalogStore } from "../catalog/store";
import { loadImageFeedConfig } from "../config";
import { getDatabase } from "../db";
import type { BuildPlanV2 } from "../domain/build-plan";
import { loadSourceRegistry } from "../sources/registry";
import type { SourceRegistry } from "../sources/types";
import { extensionLookupEntry } from "../extension/lookup";
import { loadExtensionBundles } from "../extension/bundles";
import { loadCommonPreset, CommonPresetError } from "../presets/common";

export type PreparedPlan =
  | { ok: true; plan: Awaited<ReturnType<typeof createBuildPlan>> }
  | { ok: false; status: number; body: Record<string, unknown> };

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

  const plan = await createBuildPlan(form, {
    baseVersion: snapshot.baseVersion,
    feedCommit: snapshot.feedCommit,
    sourceNote: snapshot.sourceNote,
    sourcePins: snapshot.sourcePins,
    profile,
    lookup: (name) => {
      const pkg = store.getPackage(snapshot.id, name);
      return pkg ? toLookupEntry(pkg) : null;
    },
    lookupAll: (name) => store.getPackageCandidates(snapshot.id, name).map(toLookupEntry),
    hashPassword: (password) => hashRootPassword(password),
  });
  return { ok: true, plan };
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
  return {
    lookup: (name: string) => {
      const fromCatalog = catalogLookup(name);
      if (fromCatalog) return fromCatalog;
      const record = registry.lookup(name, { source: "extension" });
      return record ? extensionLookupEntry(record) : null;
    },
    lookupAll: (name: string) => {
      const candidates = catalogLookupAll(name);
      const record = registry.lookup(name, { source: "extension" });
      const extension = record ? extensionLookupEntry(record) : null;
      return extension ? [...candidates, extension] : candidates;
    },
  };
}

export type PreparedPlanV2 =
  | { ok: true; plan: BuildPlanV2; conflicts: BuildConflict[] }
  | { ok: false; status: number; body: Record<string, unknown> };

/** V2 counterpart of `preparePlanForForm`; never used for V1 plan requests. */
export async function preparePlanV2ForForm(form: BuildFormInputV2): Promise<PreparedPlanV2> {
  const store = createCatalogStore(getDatabase());
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

  const outcome = await createBuildPlanV2(form, {
    baseVersion: snapshot.baseVersion,
    feedCommit: snapshot.feedCommit,
    sourceNote: snapshot.sourceNote,
    sourcePins: snapshot.sourcePins,
    feedOptions: loadImageFeedConfig(),
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
  return { ok: true, plan: outcome.plan, conflicts: outcome.conflicts };
}
