import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getConfig } from "../config";

/**
 * Seal a small JSON payload at rest with a key derived from SESSION_SECRET.
 *
 * The retry queue must be able to rebuild a failed submission, which means it
 * needs the original form body including the root password. Storing that in
 * plaintext would put a credential in the SQLite file, so every body is sealed
 * with AES-256-GCM: a database leak alone cannot recover it.
 */
function key(): Buffer {
  return createHash("sha256").update(`combinewrt-seal:${getConfig().sessionSecret}`).digest();
}

export function sealJson(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [iv.toString("base64"), cipher.getAuthTag().toString("base64"), ciphertext.toString("base64")].join(".");
}

export function openSealedJson(value: string): unknown {
  const [ivPart, tagPart, bodyPart] = value.split(".");
  if (!ivPart || !tagPart || !bodyPart) throw new Error("sealed payload is malformed");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivPart, "base64"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(bodyPart, "base64")), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as unknown;
}
