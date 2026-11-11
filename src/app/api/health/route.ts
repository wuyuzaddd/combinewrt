import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { getDatabase } from "@/lib/db";

export async function GET() {
  try {
    loadConfig();
    getDatabase().prepare("SELECT 1 AS ok").get();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "unknown startup error" },
      { status: 503 },
    );
  }
}
