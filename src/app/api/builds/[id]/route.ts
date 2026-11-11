import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current-session";
import { getBuildService } from "@/lib/builds";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const build = await getBuildService().refresh(id);
  if (!build) return NextResponse.json({ ok: false, error: "build not found" }, { status: 404 });
  return NextResponse.json({ ok: true, build });
}
