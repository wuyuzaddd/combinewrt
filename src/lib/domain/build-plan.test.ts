import { describe, expect, it } from "vitest";
import { isBuildPlanV2, readBuildPlan } from "./build-plan";
import type { BuildPlanV1, BuildPlanV2 } from "./build-plan";

function legacyPlan(): BuildPlanV1 {
  return {
    baseVersion: "25.12.2",
    feedCommit: "feed-commit",
    sourceNote: "fixture",
    sourcePins: { official: {}, dllkids: null, supplement: null, kernel: null },
    profileId: "generic",
    profileTitle: "Generic x86/64",
    imageType: "ext4-efi",
    packages: ["luci"],
    topLevelPackages: ["luci"],
    resolved: [],
    downloads: [],
    missingDependencies: [],
    conflicts: [],
    files: [],
    artifactName: "image.img.gz",
    imageBuilderCommand: "make image",
    createdAt: "2026-11-13T00:00:00.000Z",
  };
}

function v2Plan(): BuildPlanV2 {
  return {
    ...legacyPlan(),
    schemaVersion: 2,
    channel: "release",
    target: { id: "x86/64", architecture: "x86_64", subtarget: "generic", title: "x86/64" },
    deviceProfile: { targetId: "x86/64", id: "generic", title: "Generic x86/64", capabilities: [] },
    kernelLine: { id: "6.12", version: "6.12", engine: "imagebuilder" },
    imageVariant: { boot: "efi", filesystem: "ext4", artifact: "combined" },
    basePreset: { id: "base-preset", layer: "file/board" },
    overlays: [],
    engine: "imagebuilder",
  };
}

describe("build plan schema", () => {
  it("reads a legacy plan without schemaVersion as a read-only V1 plan", () => {
    const raw = JSON.parse(JSON.stringify(legacyPlan())) as unknown;
    const readable = readBuildPlan(raw);

    expect(readable.schemaVersion).toBe(1);
    expect(readable.readOnly).toBe(true);
    expect(isBuildPlanV2(readable.plan)).toBe(false);
    expect(readable.plan.artifactName).toBe("image.img.gz");
  });

  it("keeps an explicit V1 plan read-only", () => {
    const readable = readBuildPlan({ ...legacyPlan(), schemaVersion: 1 });

    expect(readable.schemaVersion).toBe(1);
    expect(readable.readOnly).toBe(true);
  });

  it("distinguishes a V2 plan by schemaVersion 2 and keeps V1 fields intact", () => {
    const raw = JSON.parse(JSON.stringify(v2Plan())) as unknown;
    const readable = readBuildPlan(raw);

    expect(readable.schemaVersion).toBe(2);
    expect(readable.readOnly).toBe(false);
    expect(isBuildPlanV2(readable.plan)).toBe(true);
    if (isBuildPlanV2(readable.plan)) {
      expect(readable.plan.target.id).toBe("x86/64");
      expect(readable.plan.imageVariant.artifact).toBe("combined");
      expect(readable.plan.imageType).toBe("ext4-efi");
      expect(readable.plan.baseVersion).toBe("25.12.2");
    }
  });

  it("rejects non-objects and unknown schema versions instead of guessing", () => {
    expect(() => readBuildPlan(null)).toThrow(/object/i);
    expect(() => readBuildPlan([])).toThrow(/object/i);
    expect(() => readBuildPlan({ schemaVersion: 3 })).toThrow(/schemaVersion/);
  });
});
