import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current-session";
import { isBuildPlanV2Form, validateBuildForm, validateBuildFormV2 } from "@/lib/build/validate";
import { getBuildService } from "@/lib/builds";
import { preparePlanForForm, preparePlanV2ForForm } from "@/lib/builds/prepare";
import { exportBuildConfig, formStateFromSubmitBody } from "@/app/build/form-model";

export async function GET(request: Request = new Request("http://localhost/api/builds")) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get("pageSize")) || 20));
  const service = getBuildService();
  await service.refreshActive(20);
  return NextResponse.json({
    ok: true,
    builds: service.list(pageSize, (page - 1) * pageSize),
    total: service.count(),
    page,
    pageSize,
  });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);

  // V2 submission (ticket 15): the Simple/Advanced form posts the V2 triple. It
  // reuses the ticket-03 planner and the ticket-13 queue, so a submitted V2
  // plan is enqueued and dispatched exactly like a V1 build.
  if (isBuildPlanV2Form(body)) {
    const validation = validateBuildFormV2(body);
    if (!validation.ok) return NextResponse.json({ ok: false, issues: validation.issues }, { status: 400 });

    try {
      const prepared = await preparePlanV2ForForm(validation.value);
      if (!prepared.ok) return NextResponse.json(prepared.body, { status: prepared.status });
      if (prepared.conflicts.length > 0) {
        return NextResponse.json(
          { ok: false, conflicts: prepared.conflicts, plan: prepared.plan },
          { status: 409 },
        );
      }

      // Persist the portable form snapshot with the build so a failed build can
      // be reloaded or exported without the browser draft (no root password).
      const storedConfig = exportBuildConfig(formStateFromSubmitBody(validation.value as unknown as Record<string, unknown>));
      const build = await getBuildService().submit(prepared.plan, storedConfig);
      if (build.status === "failed") {
        return NextResponse.json({ ok: false, error: build.error, build }, { status: 502 });
      }
      return NextResponse.json({ ok: true, build }, { status: 201 });
    } catch (error) {
      console.error("v2 build dispatch failed", error);
      return NextResponse.json({ ok: false, error: "build dispatch failed" }, { status: 500 });
    }
  }

  // Legacy V1 form: ADR 0009 ruling 3 maps it onto the implicit V2 defaults
  // (`preparePlanForForm`), so a new submission is never a schemaVersion 1 plan.
  const validation = validateBuildForm(body);
  if (!validation.ok) return NextResponse.json({ ok: false, issues: validation.issues }, { status: 400 });

  try {
    const prepared = await preparePlanForForm(validation.value);
    if (!prepared.ok) return NextResponse.json(prepared.body, { status: prepared.status });
    if (prepared.conflicts.length > 0) {
      return NextResponse.json({ ok: false, conflicts: prepared.conflicts, plan: prepared.plan }, { status: 409 });
    }

    const build = await getBuildService().submit(prepared.plan);
    if (build.status === "failed") {
      return NextResponse.json({ ok: false, error: build.error, build }, { status: 502 });
    }
    return NextResponse.json({ ok: true, build }, { status: 201 });
  } catch (error) {
    console.error("build dispatch failed", error);
    return NextResponse.json({ ok: false, error: "build dispatch failed" }, { status: 500 });
  }
}
