import { toLookupEntry } from "../build/lookup";
import { createBuildPlan } from "../build/plan";
import { createBuildPlanV2 } from "../build/plan-v2";
import { hashRootPassword } from "../build/password";
import type { BuildConflict, BuildFormInput, BuildFormInputV2 } from "../build/types";
import { loadCapabilities } from "../catalog/capabilities";
import { createCatalogStore } from "../catalog/store";
import { getDatabase } from "../db";
import type { BuildPlanV2 } from "../domain/build-plan";
import { loadSourceRegistry } from "../sources/registry";

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

export type PreparedPlanV2 =
  | { ok: true; plan: BuildPlanV2; conflicts: BuildConflict[] }
  | { ok: false; status: number; body: Record<string, unknown> };

/** V2 counterpart of `preparePlanForForm`; never used for V1 plan requests. */
export async function preparePlanV2ForForm(form: BuildFormInputV2): Promise<PreparedPlanV2> {
  const store = createCatalogStore(getDatabase());
  const snapshot = store.getActiveSnapshot();
  if (!snapshot) {
    return { ok: false, status: 409, body: { ok: false, error: "no active catalog snapshot" } };
  }

  const outcome = await createBuildPlanV2(form, {
    baseVersion: snapshot.baseVersion,
    feedCommit: snapshot.feedCommit,
    sourceNote: snapshot.sourceNote,
    sourcePins: snapshot.sourcePins,
    catalogProfiles: store.listProfiles(snapshot.id),
    capabilities: loadCapabilities(),
    sources: loadSourceRegistry(),
    lookup: (name) => {
      const pkg = store.getPackage(snapshot.id, name);
      return pkg ? toLookupEntry(pkg) : null;
    },
    lookupAll: (name) => store.getPackageCandidates(snapshot.id, name).map(toLookupEntry),
    hashPassword: (password) => hashRootPassword(password),
  });

  if (!outcome.ok) {
    return { ok: false, status: outcome.status, body: { ok: false, issues: outcome.issues } };
  }
  return { ok: true, plan: outcome.plan, conflicts: outcome.conflicts };
}
