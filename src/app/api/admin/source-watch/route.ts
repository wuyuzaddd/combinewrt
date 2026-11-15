import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current-session";
import { getSourceWatchService } from "@/lib/source-watch";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, overview: getSourceWatchService().readOverview() });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = body?.action;
  if (action !== "check" && action !== "adopt" && action !== "rollback") {
    return NextResponse.json(
      { ok: false, error: "action must be check, adopt or rollback" },
      { status: 400 },
    );
  }

  const service = getSourceWatchService();
  try {
    if (action === "check") {
      const result = await service.check();
      return NextResponse.json(
        { ok: result.status !== "error", result, overview: service.readOverview() },
        { status: result.status === "error" ? 502 : 200 },
      );
    }

    const result =
      action === "adopt"
        ? await service.adopt({ force: body?.force === true, adoptedBy: session.sub })
        : await service.rollback({ adoptedBy: session.sub });

    if (!result.ok) {
      const status = result.blocked ? 409 : 400;
      return NextResponse.json({ ok: false, result, overview: service.readOverview() }, { status });
    }
    return NextResponse.json({ ok: true, result, overview: service.readOverview() });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "source watch update failed",
        overview: service.readOverview(),
      },
      { status: 500 },
    );
  }
}
