import { createHmac, timingSafeEqual } from "node:crypto";

export interface SessionPayload {
  sub: string;
  iat: number;
  exp: number;
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function signSession(payload: SessionPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

function isPayload(value: unknown): value is SessionPayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.sub === "string" &&
    candidate.sub.length > 0 &&
    typeof candidate.iat === "number" &&
    typeof candidate.exp === "number"
  );
}

export function verifySession(token: string, secret: string, now = Date.now()): SessionPayload | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, signature] = parts;
  if (!body || !signature) return null;

  const expected = sign(body, secret);
  const provided = Buffer.from(signature, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  if (provided.length !== expectedBytes.length || !timingSafeEqual(provided, expectedBytes)) {
    return null;
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!isPayload(decoded)) return null;
  if (decoded.exp * 1000 <= now) return null;
  return decoded;
}
