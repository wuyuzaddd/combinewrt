export const SCRYPT_SALT_BYTES = 16;
export const SCRYPT_KEY_BYTES = 64;
export const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

export const PASSWORD_HASH_PATTERN = /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/;

export function formatPasswordHash(salt: Buffer, derived: Buffer): string {
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}
