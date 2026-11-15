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
