import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import type { BuildPlan } from "../build/types";

/**
 * Encrypted dispatch payload for queued builds (row 11 fix, 2026-11-18).
 *
 * `builds.plan_json` stays redacted at rest (see `redact.ts`). The full plan —
 * including generated file contents and typed network secrets — is sealed with
 * AES-256-GCM under a key derived from `SESSION_SECRET` and stored in
 * `builds.dispatch_payload`. That lets the reconciler pump (a different module
 * instance, or a fresh process) dispatch a build that waited behind the
 * concurrency cap, without ever writing a secret in plaintext.
 *
 * Each build gets a fresh random 96-bit IV. Only the sealed envelope is stored;
 * the plaintext plan exists in memory for the duration of the dispatch call.
 */
const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const ENVELOPE_VERSION = 1;

/**
 * Fixed HKDF salt/info strings. HKDF is appropriate here because
 * `SESSION_SECRET` is already a high-entropy (>= 32 character) secret; the
 * domain separator keeps this key distinct from the HMAC session-cookie key.
 */
const HKDF_SALT = Buffer.from("combinewrt/build-dispatch-payload", "utf8");
const HKDF_INFO = Buffer.from("aes-256-gcm/v1", "utf8");

export interface DispatchPayloadCodec {
  /** Encrypt a full plan for at-rest storage. */
  seal(plan: BuildPlan): string;
  /** Decrypt a stored envelope; throws when it is missing, tampered with or sealed under another key. */
  open(payload: string): BuildPlan;
}

export class DispatchPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DispatchPayloadError";
  }
}

interface Envelope {
  v: number;
  iv: string;
  tag: string;
  data: string;
}

/** Derive the AES-256 key used for build dispatch payloads from SESSION_SECRET. */
export function deriveDispatchKey(sessionSecret: string): Buffer {
  if (typeof sessionSecret !== "string" || sessionSecret.length < 32) {
    throw new Error("build dispatch payloads require a SESSION_SECRET of at least 32 characters");
  }
  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(sessionSecret, "utf8"),
      HKDF_SALT,
      HKDF_INFO,
      KEY_BYTES,
    ),
  );
}

/** Seal one full plan into the JSON envelope stored in `builds.dispatch_payload`. */
export function sealDispatchPayload(plan: BuildPlan, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(plan), "utf8"),
    cipher.final(),
  ]);
  const envelope: Envelope = {
    v: ENVELOPE_VERSION,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: ciphertext.toString("base64"),
  };
  return JSON.stringify(envelope);
}

/**
 * Open a stored envelope. Authentication failures deliberately collapse into a
 * single message: a tampered ciphertext and a wrong key are indistinguishable to
 * the caller, and neither may leak plaintext (or a secret) in the error.
 */
export function openDispatchPayload(payload: string, key: Buffer): BuildPlan {
  let envelope: Envelope;
  try {
    envelope = JSON.parse(payload) as Envelope;
  } catch {
    throw new DispatchPayloadError("build dispatch payload is not a valid envelope");
  }
  if (
    !envelope ||
    typeof envelope !== "object" ||
    envelope.v !== ENVELOPE_VERSION ||
    typeof envelope.iv !== "string" ||
    typeof envelope.tag !== "string" ||
    typeof envelope.data !== "string"
  ) {
    throw new DispatchPayloadError("build dispatch payload has an unsupported or incomplete envelope");
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(envelope.iv, "base64"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.data, "base64")),
      decipher.final(),
    ]);
    const plan = JSON.parse(plaintext.toString("utf8")) as BuildPlan;
    if (!plan || typeof plan !== "object") {
      throw new DispatchPayloadError("build dispatch payload did not contain a plan");
    }
    return plan;
  } catch (error) {
    if (error instanceof DispatchPayloadError) throw error;
    throw new DispatchPayloadError(
      "build dispatch payload failed authentication (tampered or encrypted with a different SESSION_SECRET)",
    );
  }
}

export function createDispatchPayloadCodec(sessionSecret: string): DispatchPayloadCodec {
  const key = deriveDispatchKey(sessionSecret);
  return {
    seal: (plan) => sealDispatchPayload(plan, key),
    open: (payload) => openDispatchPayload(payload, key),
  };
}
