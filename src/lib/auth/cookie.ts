import { SESSION_TTL_SECONDS } from "./service";

export const SESSION_COOKIE = "combinewrt_session";

export interface SessionCookieOptions {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: number;
}

export function sessionCookieOptions(secure: boolean): SessionCookieOptions {
  return { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: SESSION_TTL_SECONDS };
}
