import { describe, expect, it } from "vitest";
import { hashPassword } from "./password";
import { createRateLimiter } from "./rate-limit";
import { verifySession } from "./session";
import { createAuthService } from "./service";

const SECRET = "0123456789abcdef0123456789abcdef";
const NOW = 1_800_000_000_000;
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

function setup(limit = 3) {
  const config = { sessionSecret: SECRET, adminPasswordHash: hashPassword("right-password") };
  const limiter = createRateLimiter({ limit, windowMs: 15 * 60 * 1000, now: () => NOW });
  const service = createAuthService({ config, limiter, now: () => NOW });
  return { service };
}

describe("auth service login", () => {
  it("issues a verifiable 7-day session for the right password", () => {
    const { service } = setup();
    const result = service.login("right-password", "10.0.0.1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.expiresAt).toBe(NOW + TTL_MS);
    expect(verifySession(result.token, SECRET, NOW)).toEqual({
      sub: "admin",
      iat: Math.floor(NOW / 1000),
      exp: Math.floor((NOW + TTL_MS) / 1000),
    });
  });

  it("rejects the wrong password without a token", () => {
    const { service } = setup();
    expect(service.login("wrong", "10.0.0.1")).toEqual({ ok: false, reason: "invalid-password" });
  });

  it("blocks further attempts after the configured failures", () => {
    const { service } = setup(3);
    for (let i = 0; i < 3; i += 1) expect(service.login("wrong", "10.0.0.1").ok).toBe(false);
    expect(service.login("wrong", "10.0.0.1")).toEqual({
      ok: false,
      reason: "rate-limited",
      retryAfterMs: expect.any(Number),
    });
  });

  it("does not let a correct password bypass an active block", () => {
    const { service } = setup(3);
    for (let i = 0; i < 3; i += 1) service.login("wrong", "10.0.0.1");
    const result = service.login("right-password", "10.0.0.1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("rate-limited");
  });

  it("resets the failure counter after a successful login", () => {
    const { service } = setup(3);
    service.login("wrong", "10.0.0.1");
    service.login("wrong", "10.0.0.1");
    expect(service.login("right-password", "10.0.0.1").ok).toBe(true);
    expect(service.login("wrong", "10.0.0.1")).toEqual({ ok: false, reason: "invalid-password" });
    expect(service.login("wrong", "10.0.0.1")).toEqual({ ok: false, reason: "invalid-password" });
  });
});
