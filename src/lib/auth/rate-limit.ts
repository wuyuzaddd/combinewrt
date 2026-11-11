export interface RateLimiterOptions {
  limit?: number;
  windowMs?: number;
  now?: () => number;
}

export interface RateLimitResult {
  blocked: boolean;
  retryAfterMs: number;
}

interface Bucket {
  count: number;
  windowStart: number;
}

export interface RateLimiter {
  check(key: string): RateLimitResult;
  recordFailure(key: string): void;
  reset(key: string): void;
}

export function createRateLimiter({
  limit = 5,
  windowMs = 15 * 60 * 1000,
  now = Date.now,
}: RateLimiterOptions = {}): RateLimiter {
  const buckets = new Map<string, Bucket>();

  function current(key: string): Bucket | null {
    const bucket = buckets.get(key);
    if (!bucket) return null;
    if (now() - bucket.windowStart >= windowMs) {
      buckets.delete(key);
      return null;
    }
    return bucket;
  }

  return {
    check(key) {
      const bucket = current(key);
      if (!bucket || bucket.count < limit) {
        return { blocked: false, retryAfterMs: 0 };
      }
      return { blocked: true, retryAfterMs: Math.max(0, bucket.windowStart + windowMs - now()) };
    },
    recordFailure(key) {
      const bucket = current(key);
      if (bucket) {
        bucket.count += 1;
      } else {
        buckets.set(key, { count: 1, windowStart: now() });
      }
    },
    reset(key) {
      buckets.delete(key);
    },
  };
}
