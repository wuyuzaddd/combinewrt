import { describe, expect, it } from "vitest";
import {
  ALLOWED_GENERATED_FILE_MODES,
  GeneratedFileRuleError,
  assertSafeGeneratedFiles,
  generatedFileViolation,
  generatedFileViolations,
  isAllowedGeneratedFileMode,
  isSafeGeneratedFilePath,
} from "./dispatch-files";

const LEGITIMATE = [
  { path: "files/etc/uci-defaults/99-combinewrt", mode: 0o755 },
  { path: "files/etc/config/samba4", mode: 0o644 },
  { path: "files/etc/apk/repositories.d/90-combinewrt.list", mode: 0o644 },
];

describe("shared generated-file rule (ticket 05)", () => {
  it("allows the overlay paths and the 0644/0755 modes the planner emits", () => {
    expect([...ALLOWED_GENERATED_FILE_MODES]).toEqual([0o644, 0o755]);
    for (const file of LEGITIMATE) {
      expect(isSafeGeneratedFilePath(file.path)).toBe(true);
      expect(isAllowedGeneratedFileMode(file.mode)).toBe(true);
      expect(generatedFileViolation(file)).toBeNull();
    }
    expect(generatedFileViolations(LEGITIMATE)).toEqual([]);
    expect(() => assertSafeGeneratedFiles(LEGITIMATE)).not.toThrow();
  });

  it.each([
    "../../etc/passwd",
    "/etc/shadow",
    "files/../x",
    "files/etc/../../x",
    "etc/passwd",
    "files/",
    "files//etc/passwd",
    "files/etc/config/bad name",
  ])("rejects the unsafe path %s", (path) => {
    expect(isSafeGeneratedFilePath(path)).toBe(false);
    expect(generatedFileViolation({ path, mode: 0o644 })).toMatch(/files\/ overlay path/);
  });

  it.each([0o7777, 0o600, 0o400, 0o000, -1, 0o1000])("rejects mode %s", (mode) => {
    expect(isAllowedGeneratedFileMode(mode)).toBe(false);
    expect(generatedFileViolation({ path: "files/etc/config/x", mode })).toMatch(/mode/);
  });

  it("reports every violation before dispatch and names the offending files", () => {
    const violations = generatedFileViolations([
      { path: "../../etc/passwd", mode: 0o644 },
      { path: "files/etc/config/x", mode: 0o7777 },
    ]);
    expect(violations).toHaveLength(2);
    expect(() => assertSafeGeneratedFiles([{ path: "/etc/shadow", mode: 0o755 }])).toThrow(
      GeneratedFileRuleError,
    );
    expect(() => assertSafeGeneratedFiles([{ path: "/etc/shadow", mode: 0o755 }])).toThrow(/etc\/shadow/);
  });
});
