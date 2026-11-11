import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current-session";
import { getDatabase } from "@/lib/db";
import { createCatalogStore } from "@/lib/catalog/store";
import { createBuildPlan } from "@/lib/build/plan";
import { hashRootPassword } from "@/lib/build/password";
import { validateBuildForm } from "@/lib/build/validate";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const validation = validateBuildForm(body);
  if (!validation.ok) {
    return NextResponse.json({ ok: false, issues: validation.issues }, { status: 400 });
  }
  const form = validation.value;

  const store = createCatalogStore(getDatabase());
  const snapshot = store.getActiveSnapshot();
  if (!snapshot) {
    return NextResponse.json({ ok: false, error: "no active catalog snapshot" }, { status: 409 });
  }

  const profile = store.listProfiles(snapshot.id).find((item) => item.id === form.profile);
  if (!profile) {
    return NextResponse.json({ ok: false, issues: [`profile: unknown profile ${form.profile}`] }, { status: 400 });
  }
  if (!profile.formats.includes(form.imageType)) {
    return NextResponse.json(
      { ok: false, issues: [`imageType: ${form.imageType} is not available for ${profile.id}`] },
      { status: 400 },
    );
  }

  try {
    const plan = await createBuildPlan(form, {
      baseVersion: snapshot.baseVersion,
      feedCommit: snapshot.feedCommit,
      sourceNote: snapshot.sourceNote,
      profile,
      lookup: (name) => store.getPackage(snapshot.id, name),
      hashPassword: (password) => hashRootPassword(password),
    });

    if (plan.conflicts.length > 0) {
      return NextResponse.json({ ok: false, conflicts: plan.conflicts, plan }, { status: 409 });
    }
    return NextResponse.json({ ok: true, plan });
  } catch (error) {
    console.error("build plan failed", error);
    return NextResponse.json({ ok: false, error: "build plan failed" }, { status: 500 });
  }
}
