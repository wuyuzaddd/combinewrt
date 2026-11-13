import { describe, expect, it } from "vitest";
import { complianceReason, createComplianceReport } from "./compliance";
import type { ResolvedEntry } from "./build/types";

function entry(overrides: Partial<ResolvedEntry> = {}): ResolvedEntry {
  return {
    name: "demo",
    version: "1.0-r1",
    source: "selected",
    packageSource: "official",
    sourcePin: "pin",
    sha256: null,
    feed: "packages",
    license: "MIT",
    proprietary: false,
    ...overrides,
  };
}

describe("complianceReason", () => {
  it("accepts a declared non-proprietary license", () => {
    expect(complianceReason({ license: "GPL-2.0-only", proprietary: false })).toBeNull();
  });

  it("rejects a proprietary flag even when a license string exists", () => {
    expect(complianceReason({ license: "Proprietary", proprietary: true })).toBe("proprietary");
  });

  it("rejects missing license metadata", () => {
    expect(complianceReason({ license: null, proprietary: false })).toBe("unknown-license");
    expect(complianceReason({ license: "  ", proprietary: false })).toBe("unknown-license");
  });
});

describe("createComplianceReport", () => {
  it("marks a build public only when every package is compliant", () => {
    const report = createComplianceReport([entry(), entry({ name: "lib", license: "Apache-2.0" })]);
    expect(report).toEqual({ publicEligible: true, issues: [] });
  });

  it("collects proprietary and missing-license packages with reasons", () => {
    const report = createComplianceReport([
      entry({ name: "fastnet", license: "Proprietary", proprietary: true }),
      entry({ name: "mystery", license: null, proprietary: false }),
      entry({ name: "lucky", license: null, proprietary: false, packageSource: "dllkids" }),
    ]);
    expect(report.publicEligible).toBe(false);
    expect(report.issues).toEqual([
      { name: "fastnet", version: "1.0-r1", packageSource: "official", license: "Proprietary", reason: "proprietary" },
      { name: "mystery", version: "1.0-r1", packageSource: "official", license: null, reason: "unknown-license" },
      { name: "lucky", version: "1.0-r1", packageSource: "dllkids", license: null, reason: "unknown-license" },
    ]);
  });
});
