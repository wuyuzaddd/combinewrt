import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current-session";
import { STABLE_VERSION, discoverRelease } from "@/lib/base/releases";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const version = new URL(request.url).searchParams.get("version")?.trim() ?? "";
  if (!STABLE_VERSION.test(version)) {
    return NextResponse.json({ ok: false, error: "version must be a stable release such as 25.12.3" }, { status: 400 });
  }

  try {
    const candidate = await discoverRelease(version, fetch);
    return NextResponse.json({ ok: true, candidate });
  } catch (error) {
    const message = error instanceof Error ? error.message : "release discovery failed";
    const status = message.includes("was not found") ? 404 : 502;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
