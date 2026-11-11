import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current-session";
import { getBuildService } from "@/lib/builds";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const service = getBuildService();
  const current = service.get(id);
  if (!current) return NextResponse.json({ ok: false, error: "build not found" }, { status: 404 });
  if (current.status !== "queued" && current.status !== "running") {
    return NextResponse.json({ ok: false, error: "build is already finished" }, { status: 409 });
  }

  const build = await service.cancel(id);
  if (!build) return NextResponse.json({ ok: false, error: "build not found" }, { status: 404 });
  if (build.status !== "cancelled") {
    return NextResponse.json(
      { ok: false, error: build.error ?? "cancellation failed" },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, build });
}
