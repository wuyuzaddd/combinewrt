import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current-session";
import { validateBuildForm } from "@/lib/build/validate";
import { preparePlanForForm } from "@/lib/builds/prepare";

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

  try {
    const prepared = await preparePlanForForm(validation.value);
    if (!prepared.ok) return NextResponse.json(prepared.body, { status: prepared.status });

    if (prepared.plan.conflicts.length > 0) {
      return NextResponse.json({ ok: false, conflicts: prepared.plan.conflicts, plan: prepared.plan }, { status: 409 });
    }
    return NextResponse.json({ ok: true, plan: prepared.plan });
  } catch (error) {
    console.error("build plan failed", error);
    return NextResponse.json({ ok: false, error: "build plan failed" }, { status: 500 });
  }
}
