import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current-session";
import { getBuildRetryService } from "@/lib/builds";

/** Waiting submissions in the feed-rotation retry queue (admin panel). */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const service = getBuildRetryService();
  return NextResponse.json({ ok: true, retries: service.list(), pending: service.pending() });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { action?: unknown; id?: unknown } | null;
  const action = body?.action;
  const id = body?.id;
  if (action !== "retry" && action !== "cancel") {
    return NextResponse.json({ ok: false, error: "action must be retry or cancel" }, { status: 400 });
  }
  if (typeof id !== "string" || id.trim() === "") {
    return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
  }
  const service = getBuildRetryService();
  const changed = action === "retry" ? service.retryNow(id) : service.cancel(id);
  return NextResponse.json(
    { ok: changed, retries: service.list(), pending: service.pending() },
    { status: changed ? 200 : 404 },
  );
}
