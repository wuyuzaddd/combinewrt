import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current-session";
import { getConfig } from "@/lib/config";
import { getDatabase } from "@/lib/db";
import { refreshCatalog } from "@/lib/catalog/service";
import { createImmortalWrtSource } from "@/lib/catalog/source";

export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const config = getConfig();
    const result = await refreshCatalog({
      source: createImmortalWrtSource({ baseVersion: config.baseVersion, apkBin: config.apkBin }),
      db: getDatabase(),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("catalog refresh failed", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "catalog refresh failed" },
      { status: 502 },
    );
  }
}
