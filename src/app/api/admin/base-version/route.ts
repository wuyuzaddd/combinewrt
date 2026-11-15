import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current-session";
import { getBaseVersionService, readBaseVersionState } from "@/lib/base";
import { STABLE_VERSION } from "@/lib/base/releases";
import { validateBaseVersionInput } from "@/lib/base/records";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = body?.action;
  if (action !== "bump" && action !== "revert" && action !== "register") {
    return NextResponse.json({ ok: false, error: "action must be bump, revert or register" }, { status: 400 });
  }

  const service = getBaseVersionService();
  try {
    if (action === "register") {
      const parsed = validateBaseVersionInput(body);
      if (!parsed.ok) {
        return NextResponse.json({ ok: false, errors: parsed.errors }, { status: 400 });
      }
      const record = service.register(parsed.value);
      return NextResponse.json({ ok: true, record, state: readBaseVersionState() });
    }

    if (action === "bump") {
      if (typeof body?.version !== "string" || !STABLE_VERSION.test(body.version)) {
        return NextResponse.json({ ok: false, error: "version must be a stable release such as 25.12.3" }, { status: 400 });
      }
      await service.bump(body.version);
    } else {
      await service.revert();
    }
    return NextResponse.json({ ok: true, state: readBaseVersionState() });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "base version update failed" },
      { status: 400 },
    );
  }
}
