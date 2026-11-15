import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current-session";
import { getCatalogRefreshRunner } from "@/lib/catalog/refresh-scheduler";

export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    // Manual refresh bypasses the daily freshness check but shares single-flight
    // with the scheduler.
    const outcome = await getCatalogRefreshRunner().run();
    if (outcome.reason) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: outcome.reason,
        message:
          outcome.reason === "in-flight"
            ? "已有目录刷新正在进行，本次请求已合并等待"
            : "目录刚刚刷新过，无需重复刷新",
      });
    }
    if (outcome.error || !outcome.result) {
      return NextResponse.json(
        { ok: false, error: outcome.error ?? "catalog refresh failed" },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true, ...outcome.result });
  } catch (error) {
    console.error("catalog refresh failed", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "catalog refresh failed" },
      { status: 502 },
    );
  }
}
