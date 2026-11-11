import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import {
  formatPasswordHash,
  PASSWORD_HASH_PATTERN,
  SCRYPT_KEY_BYTES,
  SCRYPT_OPTIONS,
  SCRYPT_SALT_BYTES,
} from "./password-format";

export function hashPassword(password: string, salt: Buffer = randomBytes(SCRYPT_SALT_BYTES)): string {
  const derived = scryptSync(password, salt, SCRYPT_KEY_BYTES, SCRYPT_OPTIONS);
  return formatPasswordHash(salt, derived);
}

export function verifyPassword(password: string, stored: string): boolean {
  if (!PASSWORD_HASH_PATTERN.test(stored)) return false;

  const [, saltHex, hashHex] = stored.split("$");
  const expected = Buffer.from(hashHex, "hex");
  const derived = scryptSync(password, Buffer.from(saltHex, "hex"), SCRYPT_KEY_BYTES, SCRYPT_OPTIONS);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
