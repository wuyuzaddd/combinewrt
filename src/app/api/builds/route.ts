import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current-session";
import { validateBuildForm } from "@/lib/build/validate";
import { getBuildService } from "@/lib/builds";
import { preparePlanForForm } from "@/lib/builds/prepare";

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
  const validation = validateBuildForm(body);
  if (!validation.ok) return NextResponse.json({ ok: false, issues: validation.issues }, { status: 400 });

  try {
    const prepared = await preparePlanForForm(validation.value);
    if (!prepared.ok) return NextResponse.json(prepared.body, { status: prepared.status });
    if (prepared.plan.conflicts.length > 0) {
      return NextResponse.json({ ok: false, conflicts: prepared.plan.conflicts, plan: prepared.plan }, { status: 409 });
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
