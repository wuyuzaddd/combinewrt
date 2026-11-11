import { describe, expect, it } from "vitest";
import { signSession, verifySession } from "./session";

const SECRET = "test-secret-0123456789abcdef0123456789abcdef";
const NOW = 1_800_000_000_000;

function payload(overrides: Partial<{ sub: string; iat: number; exp: number }> = {}) {
  return { sub: "admin", iat: Math.floor(NOW / 1000), exp: Math.floor(NOW / 1000) + 3600, ...overrides };
}

describe("session token", () => {
  it("round-trips a valid token", () => {
    const token = signSession(payload(), SECRET);
    expect(verifySession(token, SECRET, NOW)).toEqual(payload());
  });

  it("rejects a tampered payload", () => {
    const token = signSession(payload(), SECRET);
    const [, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify(payload({ sub: "root" }))).toString("base64url");
    expect(verifySession(`${forged}.${sig}`, SECRET, NOW)).toBeNull();
  });

  it("rejects a tampered signature", () => {
    const token = signSession(payload(), SECRET);
    const [body] = token.split(".");
    expect(verifySession(`${body}.AAAA`, SECRET, NOW)).toBeNull();
  });

  it("rejects a token signed with another secret", () => {
    const token = signSession(payload(), SECRET);
    expect(verifySession(token, `${SECRET}-other`, NOW)).toBeNull();
  });

  it("rejects an expired token", () => {
    const token = signSession(payload({ exp: Math.floor(NOW / 1000) - 1 }), SECRET);
    expect(verifySession(token, SECRET, NOW)).toBeNull();
  });

  it("rejects malformed tokens", () => {
    expect(verifySession("", SECRET, NOW)).toBeNull();
    expect(verifySession("only-one-part", SECRET, NOW)).toBeNull();
    expect(verifySession("a.b.c", SECRET, NOW)).toBeNull();
  });
});
