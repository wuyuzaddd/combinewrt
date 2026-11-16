import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current-session";
import { getSourceWatchService } from "@/lib/source-watch";
import { getSupplementWatchService } from "@/lib/supplement-watch";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  return NextResponse.json({
    ok: true,
    overview: getSourceWatchService().readOverview(),
    supplement: getSupplementWatchService().readOverview(),
  });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = body?.action;
  if (action === "check-supplement" || action === "reconcile" || action === "promote") {
    const supplement = getSupplementWatchService();
    try {
      if (action === "check-supplement") {
        const result = await supplement.check({ trigger: "manual" });
        return NextResponse.json(
          { ok: result.status !== "error", result, supplement: supplement.readOverview() },
          { status: result.status === "error" ? 502 : 200 },
        );
      }
      if (action === "reconcile") {
        const result = await supplement.reconcile();
        return NextResponse.json({ ok: result.error === null, result, supplement: supplement.readOverview() });
      }
      const publishId = Number(body?.publishId);
      if (!Number.isInteger(publishId) || publishId <= 0) {
        return NextResponse.json({ ok: false, error: "publishId is required" }, { status: 400 });
      }
      const result = await supplement.promote(publishId, { promotedBy: session.sub });
      return NextResponse.json(
        { ok: result.ok, result, supplement: supplement.readOverview() },
        { status: result.ok ? 200 : 409 },
      );
    } catch (error) {
      return NextResponse.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : "supplement watch update failed",
          supplement: supplement.readOverview(),
        },
        { status: 500 },
      );
    }
  }

  if (action !== "check" && action !== "adopt" && action !== "rollback") {
    return NextResponse.json(
      { ok: false, error: "action must be check, adopt, rollback, check-supplement, reconcile or promote" },
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
