import { describe, expect, it } from "vitest";
import type { BuildPlan } from "../build/types";
import {
  createDispatchPayloadCodec,
  DispatchPayloadError,
  deriveDispatchKey,
  openDispatchPayload,
  sealDispatchPayload,
} from "./dispatch-payload";

const SECRET = "a".repeat(48);
const OTHER_SECRET = "b".repeat(48);

function plan(): BuildPlan {
  return {
    baseVersion: "25.12.2",
    feedCommit: "abc",
    sourceNote: "fixture",
    profileId: "generic",
    profileTitle: "Generic x86/64",
    imageType: "ext4-efi",
    packages: ["luci"],
    resolved: [],
    topLevelPackages: ["luci"],
    downloads: [],
    sourcePins: { official: {}, dllkids: null, supplement: null, kernel: null },
    missingDependencies: [],
    conflicts: [],
    files: [
      {
        path: "files/etc/uci-defaults/99-combinewrt",
        mode: 0o755,
        content: "root_password='$5$super-secret-hash'\n",
      },
    ],
    artifactName: "immortalwrt-25.12.2-x86-64-generic-ext4-combined-efi.img.gz",
    imageBuilderCommand: "make image",
    createdAt: "2026-11-11T00:00:00.000Z",
  };
}

describe("build dispatch payload encryption", () => {
  it("round-trips the full plan, including generated file contents", () => {
    const key = deriveDispatchKey(SECRET);
    const full = plan();
    const sealed = sealDispatchPayload(full, key);

    expect(sealed).not.toContain("super-secret-hash");
    expect(openDispatchPayload(sealed, key)).toEqual(full);
  });

  it("uses a fresh IV per seal so identical plans encrypt differently", () => {
    const key = deriveDispatchKey(SECRET);
    const first = sealDispatchPayload(plan(), key);
    const second = sealDispatchPayload(plan(), key);
    expect(first).not.toBe(second);
    expect(first).not.toContain(second);
  });

  it("fails authentication when the ciphertext, IV or tag is tampered with", () => {
    const key = deriveDispatchKey(SECRET);
    const sealed = sealDispatchPayload(plan(), key);
    const envelope = JSON.parse(sealed) as { iv: string; tag: string; data: string };

    const tampered = [
      { ...envelope, data: Buffer.from(envelope.data, "base64").subarray(1).toString("base64") },
      { ...envelope, iv: Buffer.alloc(12, 7).toString("base64") },
      { ...envelope, tag: Buffer.alloc(16, 9).toString("base64") },
    ];
    for (const candidate of tampered) {
      expect(() => openDispatchPayload(JSON.stringify(candidate), key)).toThrow(DispatchPayloadError);
    }
  });

  it("fails authentication with a key derived from a different SESSION_SECRET", () => {
    const sealed = sealDispatchPayload(plan(), deriveDispatchKey(SECRET));
    expect(() => openDispatchPayload(sealed, deriveDispatchKey(OTHER_SECRET))).toThrow(
      /failed authentication/,
    );
  });

  it("rejects malformed envelopes without echoing their contents", () => {
    const key = deriveDispatchKey(SECRET);
    expect(() => openDispatchPayload("not json", key)).toThrow(/not a valid envelope/);
    expect(() => openDispatchPayload(JSON.stringify({ v: 1, iv: "x", tag: "y" }), key)).toThrow(
      /incomplete envelope/,
    );
  });

  it("requires a SESSION_SECRET long enough for a stable key", () => {
    expect(() => deriveDispatchKey("short")).toThrow(/at least 32/);
  });

  it("exposes a codec that seals and opens with the same secret", () => {
    const codec = createDispatchPayloadCodec(SECRET);
    expect(codec.open(codec.seal(plan()))).toEqual(plan());
  });
});
