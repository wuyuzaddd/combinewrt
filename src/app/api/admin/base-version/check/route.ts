import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current-session";
import { getBaseVersionService, readBaseVersionState } from "@/lib/base";

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const check = await getBaseVersionService().checkForNewRelease();
  if (check.error) {
    return NextResponse.json({ ok: false, error: check.error, check }, { status: 502 });
  }
  return NextResponse.json({ ok: true, check, state: await readBaseVersionState() });
}
