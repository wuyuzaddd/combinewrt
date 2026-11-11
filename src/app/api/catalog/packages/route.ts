import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current-session";
import { getDatabase } from "@/lib/db";
import { createCatalogStore } from "@/lib/catalog/store";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get("limit") || "20", 10) || 20, 1), 50);

  const store = createCatalogStore(getDatabase());
  const snapshot = store.getActiveSnapshot();
  if (!snapshot) {
    return NextResponse.json({ ok: true, items: [], total: 0 });
  }

  const result = store.searchPackages(snapshot.id, { query, limit });
  return NextResponse.json({ ok: true, items: result.items, total: result.total });
}
