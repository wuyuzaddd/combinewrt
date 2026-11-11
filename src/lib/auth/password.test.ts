import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("admin password", () => {
  it("hashes to the documented scrypt format", () => {
    const stored = hashPassword("correct horse battery staple");
    expect(stored).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  });

  it("verifies the original password", () => {
    const stored = hashPassword("s3cret-pass");
    expect(verifyPassword("s3cret-pass", stored)).toBe(true);
  });

  it("rejects a wrong password", () => {
    const stored = hashPassword("s3cret-pass");
    expect(verifyPassword("s3cret-pas", stored)).toBe(false);
    expect(verifyPassword("", stored)).toBe(false);
  });

  it("uses a fresh salt for every hash", () => {
    expect(hashPassword("same")).not.toEqual(hashPassword("same"));
  });

  it("rejects malformed stored hashes instead of throwing", () => {
    expect(verifyPassword("x", "")).toBe(false);
    expect(verifyPassword("x", "plain-text")).toBe(false);
    expect(verifyPassword("x", "scrypt$deadbeef$deadbeef")).toBe(false);
  });
});
