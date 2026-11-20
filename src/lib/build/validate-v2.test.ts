import { describe, expect, it } from "vitest";
import { isBuildPlanV2Form, validateBuildFormV2 } from "./validate";

const base = {
  profile: "generic",
  target: "x86/64",
  kernelLine: "6.12",
  imageVariant: { boot: "efi", filesystem: "ext4", artifact: "combined" },
  hostname: "router",
  timezone: "Asia/Shanghai",
  lanIp: "192.168.5.1",
  netmask: "255.255.255.0",
  rootPassword: "correct horse",
  packages: ["luci"],
};

describe("validateBuildFormV2", () => {
  it("defaults visibility to private and never hands the V1 image type to the planner", () => {
    const result = validateBuildFormV2(base);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.visibility).toBe("private");
    expect(result.value.imageVariant).toEqual(base.imageVariant);
    expect(result.value).not.toHaveProperty("imageType");
  });

  it("keeps a requested public visibility", () => {
    const result = validateBuildFormV2({ ...base, visibility: "public" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.visibility).toBe("public");
  });

  it("accepts a legacy-boot rootfs variant without inventing an image type", () => {
    const result = validateBuildFormV2({
      ...base,
      imageVariant: { boot: "legacy", filesystem: "squashfs", artifact: "rootfs" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.imageVariant).toEqual({ boot: "legacy", filesystem: "squashfs", artifact: "rootfs" });
  });

  it("requires target, kernel line and image variant", () => {
    const result = validateBuildFormV2({ ...base, target: "", kernelLine: "", imageVariant: undefined });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.join("\n")).toMatch(/target/);
    expect(result.issues.join("\n")).toMatch(/kernelLine/);
    expect(result.issues.join("\n")).toMatch(/imageVariant/);
  });

  it("lets the planner decide overlay bounds instead of rejecting them in the form", () => {
    const zero = validateBuildFormV2({
      ...base,
      imageVariant: { ...base.imageVariant, overlaySizeMb: 0 },
    });
    expect(zero.ok).toBe(true);
  });
});

  it("accepts the negative package list, normalises it and rejects malformed names", () => {
    const normalised = validateBuildFormV2({ ...base, removePackages: [" luci ", "luci"] });
    expect(normalised.ok).toBe(true);
    if (normalised.ok) expect(normalised.value.removePackages).toEqual(["luci"]);

    const malformed = validateBuildFormV2({ ...base, removePackages: ["bad name; rm -rf /"] });
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.issues.join("\n")).toMatch(/removePackages/);
  });

describe("isBuildPlanV2Form", () => {
  it("requires an explicit schemaVersion 2 and a target id", () => {
    expect(isBuildPlanV2Form({ schemaVersion: 2, target: "x86/64", profile: "generic" })).toBe(true);
    // Field presence alone is not a declaration: these stay on the V1 path.
    expect(isBuildPlanV2Form({ imageVariant: { boot: "efi", filesystem: "ext4", artifact: "combined" } })).toBe(false);
    expect(isBuildPlanV2Form({ kernelLine: "6.12", profile: "generic" })).toBe(false);
    expect(isBuildPlanV2Form({ schemaVersion: 2, profile: "generic" })).toBe(false);
    expect(isBuildPlanV2Form({ schemaVersion: 1, target: "x86/64" })).toBe(false);
    expect(isBuildPlanV2Form({ schemaVersion: 2, target: "  " })).toBe(false);
    expect(isBuildPlanV2Form(null)).toBe(false);
    expect(isBuildPlanV2Form([])).toBe(false);
  });
});

describe("validateBuildFormV2 base-version channel (ticket 11)", () => {
  it("accepts a release base version and keeps the requested visibility", () => {
    const result = validateBuildFormV2({ ...base, baseVersion: "25.12.2", visibility: "public" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.visibility).toBe("public");
  });

  it.each(["24.10-SNAPSHOT", "25.12.3-snapshot"])(
    "accepts snapshot base version %s and forces private visibility",
    (baseVersion) => {
      const result = validateBuildFormV2({ ...base, baseVersion, visibility: "public" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.visibility).toBe("private");
      expect(result.value.baseVersion).toBe(baseVersion);
    },
  );

  it("defaults a snapshot plan to private even with no visibility field", () => {
    const result = validateBuildFormV2({ ...base, baseVersion: "24.10-SNAPSHOT" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.visibility).toBe("private");
  });

  it.each(["25.12", "v25.12.2", "25.12.2-SNAPSHOT2", "snapshot"])(
    "still rejects the malformed base version %s",
    (baseVersion) => {
      const result = validateBuildFormV2({ ...base, baseVersion });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.issues.join("\n")).toMatch(/baseVersion/);
    },
  );
});
