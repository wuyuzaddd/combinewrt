import { describe, expect, it } from "vitest";
import { validateBaseVersionInput } from "./records";

const VALID = {
  version: "25.12.3",
  releaseDate: "2026-10-01",
  imageBuilderUrl:
    "https://downloads.immortalwrt.org/releases/25.12.3/targets/x86/64/immortalwrt-imagebuilder-25.12.3-x86-64.Linux-x86_64.tar.zst",
  imageBuilderSha256: "A".repeat(64),
};

describe("base version record validation", () => {
  it("accepts a complete record and normalizes the checksum", () => {
    const result = validateBaseVersionInput(VALID);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.imageBuilderSha256).toBe("a".repeat(64));
  });

  it("rejects bad dates, mismatched URLs and short checksums", () => {
    const result = validateBaseVersionInput({
      ...VALID,
      releaseDate: "2026-02-30",
      imageBuilderUrl: "https://example.invalid/ib.tar.zst",
      imageBuilderSha256: "abc",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join("\n")).toContain("YYYY-MM-DD");
      expect(result.errors.join("\n")).toContain("不匹配");
      expect(result.errors.join("\n")).toContain("64 位十六进制");
    }
  });

  it("rejects unstable versions", () => {
    const result = validateBaseVersionInput({ ...VALID, version: "25.12-SNAPSHOT" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toContain("稳定版本");
  });

  it("rejects a non-object body", () => {
    expect(validateBaseVersionInput(null)).toEqual({ ok: false, errors: ["请求体必须是 JSON 对象"] });
  });
});
