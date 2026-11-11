import type { AppConfig } from "../config";
import { verifyPassword } from "./password";
import type { RateLimiter } from "./rate-limit";
import { signSession } from "./session";

export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export type LoginResult =
  | { ok: true; token: string; expiresAt: number }
  | { ok: false; reason: "invalid-password" }
  | { ok: false; reason: "rate-limited"; retryAfterMs: number };

export interface AuthServiceDeps {
  config: Pick<AppConfig, "sessionSecret" | "adminPasswordHash">;
  limiter: RateLimiter;
  now?: () => number;
}

export interface AuthService {
  login(password: string, clientIp: string): LoginResult;
}

export function createAuthService({ config, limiter, now = Date.now }: AuthServiceDeps): AuthService {
  return {
    login(password, clientIp) {
      const limit = limiter.check(clientIp);
      if (limit.blocked) {
        return { ok: false, reason: "rate-limited", retryAfterMs: limit.retryAfterMs };
      }

      if (!verifyPassword(password, config.adminPasswordHash)) {
        limiter.recordFailure(clientIp);
        return { ok: false, reason: "invalid-password" };
      }

      limiter.reset(clientIp);
      const issuedAt = Math.floor(now() / 1000);
      const expiresAt = (issuedAt + SESSION_TTL_SECONDS) * 1000;
      const token = signSession(
        { sub: "admin", iat: issuedAt, exp: issuedAt + SESSION_TTL_SECONDS },
        config.sessionSecret,
      );
      return { ok: true, token, expiresAt };
    },
  };
}
