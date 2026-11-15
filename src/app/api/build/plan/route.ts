import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current-session";
import { isBuildPlanV2Form, validateBuildForm, validateBuildFormV2 } from "@/lib/build/validate";
import { preparePlanForForm, preparePlanV2ForForm } from "@/lib/builds/prepare";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);

  // V2 requests name the target/kernel-line/image-variant triple. Everything
  // else keeps the V1 form, composer and plan JSON untouched.
  if (isBuildPlanV2Form(body)) {
    const validation = validateBuildFormV2(body);
    if (!validation.ok) {
      return NextResponse.json({ ok: false, issues: validation.issues }, { status: 400 });
    }

    try {
      const prepared = await preparePlanV2ForForm(validation.value);
      if (!prepared.ok) return NextResponse.json(prepared.body, { status: prepared.status });

      if (prepared.conflicts.length > 0) {
        return NextResponse.json(
          { ok: false, conflicts: prepared.conflicts, plan: prepared.plan },
          { status: 409 },
        );
      }
      return NextResponse.json({ ok: true, plan: prepared.plan });
    } catch (error) {
      console.error("build plan failed", error);
      return NextResponse.json({ ok: false, error: "build plan failed" }, { status: 500 });
    }
  }

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
