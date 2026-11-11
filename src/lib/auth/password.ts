import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SALT_BYTES = 16;
const KEY_BYTES = 64;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

export function hashPassword(password: string, salt: Buffer = randomBytes(SALT_BYTES)): string {
  const derived = scryptSync(password, salt, KEY_BYTES, SCRYPT_OPTIONS);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, saltHex, hashHex] = parts;
  if (!/^[0-9a-f]{32}$/.test(saltHex) || !/^[0-9a-f]{128}$/.test(hashHex)) return false;

  const expected = Buffer.from(hashHex, "hex");
  const derived = scryptSync(password, Buffer.from(saltHex, "hex"), KEY_BYTES, SCRYPT_OPTIONS);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
