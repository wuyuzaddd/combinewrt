import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rate-limit";

function setup() {
  const clock = { now: 1_000_000 };
  const limiter = createRateLimiter({ limit: 3, windowMs: 15 * 60 * 1000, now: () => clock.now });
  return { clock, limiter };
}

describe("login rate limiter", () => {
  it("allows attempts below the limit", () => {
    const { limiter } = setup();
    limiter.recordFailure("1.2.3.4");
    limiter.recordFailure("1.2.3.4");
    expect(limiter.check("1.2.3.4")).toEqual({ blocked: false, retryAfterMs: 0 });
  });

  it("blocks once the limit is reached and reports when to retry", () => {
    const { limiter } = setup();
    for (let i = 0; i < 3; i += 1) limiter.recordFailure("1.2.3.4");
    const result = limiter.check("1.2.3.4");
    expect(result.blocked).toBe(true);
    expect(result.retryAfterMs).toBeGreaterThan(0);
    expect(result.retryAfterMs).toBeLessThanOrEqual(15 * 60 * 1000);
  });

  it("unblocks after the window elapses", () => {
    const { clock, limiter } = setup();
    for (let i = 0; i < 3; i += 1) limiter.recordFailure("1.2.3.4");
    clock.now += 15 * 60 * 1000 + 1;
    expect(limiter.check("1.2.3.4").blocked).toBe(false);
  });

  it("keeps buckets per key", () => {
    const { limiter } = setup();
    for (let i = 0; i < 3; i += 1) limiter.recordFailure("1.2.3.4");
    expect(limiter.check("5.6.7.8").blocked).toBe(false);
  });

  it("clears the bucket on reset", () => {
    const { limiter } = setup();
    for (let i = 0; i < 3; i += 1) limiter.recordFailure("1.2.3.4");
    limiter.reset("1.2.3.4");
    expect(limiter.check("1.2.3.4").blocked).toBe(false);
  });
});
