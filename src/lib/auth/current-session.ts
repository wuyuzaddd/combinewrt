import { cookies } from "next/headers";
import { getConfig } from "../config";
import { SESSION_COOKIE } from "./cookie";
import { verifySession, type SessionPayload } from "./session";

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token, getConfig().sessionSecret);
}
