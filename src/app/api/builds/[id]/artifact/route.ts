import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current-session";
import { getBuildService } from "@/lib/builds";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const service = getBuildService();
  const build = await service.refresh(id);
  if (!build) return NextResponse.json({ ok: false, error: "build not found" }, { status: 404 });
  if (build.status !== "succeeded" || !build.artifactName) {
    return NextResponse.json({ ok: false, error: "artifact is not ready" }, { status: 409 });
  }

  try {
    const artifact = await service.artifact(id);
    if (!artifact) return NextResponse.json({ ok: false, error: "artifact is not available" }, { status: 409 });
    return new Response(artifact.body as unknown as BodyInit, {
      headers: {
        "content-type": artifact.contentType,
        "content-disposition": `attachment; filename="${artifact.name.replace(/["\\\r\n]/g, "")}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("artifact download failed", error);
    const message = error instanceof Error ? error.message : String(error);
    if (/no longer available/i.test(message)) {
      return NextResponse.json(
        { ok: false, error: "artifact 已过期或已被清理（GitHub 默认保留 30 天）" },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: false, error: "artifact download failed" }, { status: 502 });
  }
}
