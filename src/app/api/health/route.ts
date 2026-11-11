import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { getDatabase } from "@/lib/db";

export async function GET() {
  try {
    loadConfig();
    getDatabase().prepare("SELECT 1 AS ok").get();
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[combinewrt] health check failed:", error);
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
