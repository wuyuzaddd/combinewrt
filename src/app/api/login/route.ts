import { NextResponse, type NextRequest } from "next/server";
import { sessionCookieOptions, SESSION_COOKIE } from "@/lib/auth/cookie";
import { createRateLimiter } from "@/lib/auth/rate-limit";
import { createAuthService } from "@/lib/auth/service";
import { getConfig } from "@/lib/config";

const limiter = createRateLimiter();

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(request: NextRequest) {
  let password = "";
  try {
    const body = (await request.json()) as { password?: unknown };
    if (typeof body.password === "string") password = body.password;
  } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }

  const config = getConfig();
  const auth = createAuthService({ config, limiter });
  const result = auth.login(password, clientIp(request));

  if (!result.ok) {
    if (result.reason === "rate-limited") {
      return NextResponse.json(
        { error: "rate-limited", retryAfterMs: result.retryAfterMs },
        { status: 429, headers: { "Retry-After": String(Math.ceil(result.retryAfterMs / 1000)) } },
      );
    }
    return NextResponse.json({ error: "invalid-password" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(
    SESSION_COOKIE,
    result.token,
    sessionCookieOptions(config.appOrigin.startsWith("https://")),
  );
  return response;
}
