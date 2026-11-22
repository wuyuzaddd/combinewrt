import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current-session";
import { getBuildService } from "@/lib/builds";

/** Export the portable config a build was dispatched with (no root password). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const build = getBuildService().get(id);
  if (!build) return NextResponse.json({ ok: false, error: "not-found" }, { status: 404 });
  if (!build.config) {
    return NextResponse.json({ ok: false, error: "no-config", message: "这次构建没有保存表单配置" }, { status: 404 });
  }
  return NextResponse.json(build.config, {
    headers: { "content-disposition": `attachment; filename="combinewrt-${id.slice(0, 8)}.json"` },
  });
}
