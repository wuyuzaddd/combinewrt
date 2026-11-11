import { createBuildPlan } from "../build/plan";
import { hashRootPassword } from "../build/password";
import type { BuildFormInput } from "../build/types";
import { createCatalogStore } from "../catalog/store";
import { getDatabase } from "../db";

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
    profile,
    lookup: (name) => store.getPackage(snapshot.id, name),
    hashPassword: (password) => hashRootPassword(password),
  });
  return { ok: true, plan };
}
