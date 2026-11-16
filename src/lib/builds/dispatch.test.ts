import { describe, expect, it } from "vitest";
import { artifactNameV2 } from "../build/artifact-name";
import type { BuildPlan, BuildPlanV2 } from "../build/types";
import { EMPTY_SOURCE_PINS } from "../catalog/types";
import type { ImageVariant } from "../domain/types";
import { mapImageVariant } from "../image/variants";
import { buildDispatchPayload, buildDispatchRequest, imageBuilderCommandForVariant } from "./dispatch";
import type { SourceDispatchPayload } from "./source-dispatch";

const BASE = {
  baseVersion: "25.12.2",
  targetId: "x86/64",
  profileId: "generic",
} as const;

function v1Plan(overrides: Partial<BuildPlan> = {}): BuildPlan {
  return {
    baseVersion: BASE.baseVersion,
    feedCommit: "1198b107ed1b8505f16726156bf37790253e343f",
    sourceNote: "",
    sourcePins: EMPTY_SOURCE_PINS,
    profileId: BASE.profileId,
    profileTitle: "Generic x86/64",
    imageType: "ext4-efi",
    packages: ["luci"],
    topLevelPackages: ["luci"],
    resolved: [],
    downloads: [],
    missingDependencies: [],
    conflicts: [],
    files: [
      { path: "files/etc/uci-defaults/99-combinewrt", content: "#!/bin/sh\nexit 0\n", mode: 0o755 },
    ],
    artifactName: "immortalwrt-25.12.2-x86-64-generic-ext4-combined-efi.img.gz",
    imageBuilderCommand: 'make -j$(nproc) image PROFILE=generic PACKAGES="luci" FILES=files',
    createdAt: "2026-11-15T00:00:00.000Z",
    ...overrides,
  } as BuildPlan;
}

function v2Plan(variant: ImageVariant, overrides: Partial<BuildPlanV2> = {}): BuildPlanV2 {
  return {
    ...v1Plan(),
    schemaVersion: 2,
    channel: "release",
    target: { id: BASE.targetId, architecture: "x86_64", subtarget: "64", title: "x86/64" },
    deviceProfile: { targetId: BASE.targetId, id: BASE.profileId, title: "Generic x86/64", capabilities: [] },
    kernelLine: { id: "linux-6.6", version: "6.6", engine: "imagebuilder" },
    imageVariant: variant,
    basePreset: { id: "minimal", layer: "file/board" },
    overlays: [{ id: "luci-ui", layer: "package/kernel" }],
    engine: "imagebuilder",
    ...overrides,
  } as BuildPlanV2;
}

const PAYLOAD_KEYS = [
  "artifactName",
  "baseVersion",
  "buildId",
  "composition",
  "feedCommit",
  "files",
  "imageBuilderCommand",
  "imageType",
  "packages",
  "profileId",
].sort();

describe("buildDispatchPayload", () => {
  it("keeps the V1 payload exactly as the workflow has always read it", () => {
    const payload = buildDispatchPayload(v1Plan(), { buildId: "b1", artifactName: "image.gz" });

    expect(Object.keys(payload).sort()).toEqual(PAYLOAD_KEYS);
    expect(payload).toMatchObject({
      buildId: "b1",
      baseVersion: "25.12.2",
      profileId: "generic",
      imageType: "ext4-efi",
      packages: ["luci"],
      artifactName: "image.gz",
      imageBuilderCommand: 'make -j$(nproc) image PROFILE=generic PACKAGES="luci" FILES=files',
    });
    expect(payload.composition).toEqual({
      topLevelPackages: ["luci"],
      sourcePins: EMPTY_SOURCE_PINS,
      downloads: [],
    });
    expect(payload.composition.v2).toBeUndefined();
  });

  it("keeps the ten top-level properties for V2 and nests the plan under composition.v2", () => {
    const variant: ImageVariant = { boot: "efi", filesystem: "ext4", artifact: "combined", overlaySizeMb: 512 };
    const plan = v2Plan(variant, { artifactName: artifactNameV2({ ...BASE, imageVariant: variant }) });
    const payload = buildDispatchPayload(plan, { buildId: "b2", artifactName: plan.artifactName });

    expect(Object.keys(payload).sort()).toEqual(PAYLOAD_KEYS);
    expect(payload.composition.v2).toEqual({
      schemaVersion: 2,
      engine: "imagebuilder",
      target: plan.target,
      kernelLine: plan.kernelLine,
      imageVariant: variant,
      modes: ["luci-ui"],
      products: [artifactNameV2({ ...BASE, imageVariant: variant })],
      makeTargets: ["image"],
    });
  });

  it("dispatches the variant-derived command instead of the V1 formula", () => {
    const variant: ImageVariant = { boot: "legacy", filesystem: "squashfs", artifact: "combined" };
    const plan = v2Plan(variant, { artifactName: artifactNameV2({ ...BASE, imageVariant: variant }) });
    const mapping = mapImageVariant({ ...BASE, variant });
    const payload = buildDispatchPayload(plan, { buildId: "b3", artifactName: plan.artifactName });

    expect(payload.imageBuilderCommand).toBe(imageBuilderCommandForVariant(mapping, BASE.profileId, ["luci"]));
    expect(payload.imageBuilderCommand).toContain("CONFIG_GRUB_IMAGES=y");
    expect(payload.imageBuilderCommand).toContain("CONFIG_GRUB_EFI_IMAGES=n");
    expect(payload.imageBuilderCommand).toContain("CONFIG_TARGET_ROOTFS_SQUASHFS=y");
    expect(payload.imageBuilderCommand).not.toContain("CONFIG_TARGET_ROOTFS_PARTSIZE");
  });

  it("covers the eight accepted combinations", () => {
    for (const boot of ["efi", "legacy"] as const) {
      for (const filesystem of ["ext4", "squashfs"] as const) {
        for (const artifact of ["combined", "rootfs"] as const) {
          const variant: ImageVariant = {
            boot,
            filesystem,
            artifact,
            ...(artifact === "rootfs" ? {} : { overlaySizeMb: 128 }),
          };
          const mapping = mapImageVariant({ ...BASE, variant });
          const artifactName = artifactNameV2({ ...BASE, imageVariant: variant });
          const plan = v2Plan(variant, { artifactName, imageType: mapping.imageType });
          const payload = buildDispatchPayload(plan, { buildId: "b4", artifactName });

          expect(payload.artifactName).toBe(artifactName);
          expect(payload.imageType).toBe(mapping.imageType);
          expect(payload.composition.v2?.products).toEqual([artifactName]);
          expect(payload.imageBuilderCommand).toBe(imageBuilderCommandForVariant(mapping, BASE.profileId, ["luci"]));
          // Rootfs tarballs never carry the ext4 partition size override.
          expect(payload.imageBuilderCommand.includes("CONFIG_TARGET_ROOTFS_PARTSIZE")).toBe(
            artifact !== "rootfs" && filesystem === "ext4",
          );
        }
      }
    }
  });

  it("dispatches the combined source product for VMDK/qcow2 variants", () => {
    const variant: ImageVariant = { boot: "efi", filesystem: "ext4", artifact: "qcow2", overlaySizeMb: 512 };
    const artifactName = artifactNameV2({ ...BASE, imageVariant: variant });
    const plan = v2Plan(variant, { artifactName });
    const mapping = mapImageVariant({ ...BASE, variant });
    const payload = buildDispatchPayload(plan, { buildId: "b5", artifactName });

    expect(artifactName.endsWith(".qcow2")).toBe(true);
    expect(payload.composition.v2?.products).toEqual([
      "immortalwrt-25.12.2-x86-64-generic-ext4-combined-efi.img.gz",
    ]);
    expect(payload.imageBuilderCommand).toContain("CONFIG_TARGET_ROOTFS_PARTSIZE=512");
    expect(mapping.postprocess?.steps.map((step) => step.command)).toEqual(["gzip", "qemu-img"]);
  });

  it("does not invent feedSet or preflight when the plan has none", () => {
    const variant: ImageVariant = { boot: "efi", filesystem: "ext4", artifact: "combined" };
    const plan = v2Plan(variant, { artifactName: artifactNameV2({ ...BASE, imageVariant: variant }) });
    const v2 = buildDispatchPayload(plan, { buildId: "b6", artifactName: plan.artifactName }).composition.v2;
    expect(v2).toBeDefined();
    expect(Object.keys(v2!)).not.toContain("feedSet");
    expect(Object.keys(v2!)).not.toContain("preflight");
  });
});

describe("buildDispatchRequest", () => {
  function sourcePlan(overrides: Partial<BuildPlanV2> = {}): BuildPlanV2 {
    const variant: ImageVariant = { boot: "efi", filesystem: "ext4", artifact: "combined" };
    return v2Plan(variant, {
      engine: "source",
      kernelLine: { id: "6.6", version: "6.6", engine: "source" },
      overlays: [],
      artifactName: "immortalwrt-24.10-SNAPSHOT-x86-64-generic-ext4-combined-efi.img.gz",
      ...overrides,
    });
  }

  it("keeps the combinewrt-build event for V1 and ImageBuilder plans", () => {
    const v1 = buildDispatchRequest(v1Plan(), { buildId: "b1", artifactName: "image.gz" });
    expect(v1.eventType).toBe("combinewrt-build");
    expect((v1.payload as { buildId: string }).buildId).toBe("b1");

    const variant: ImageVariant = { boot: "efi", filesystem: "ext4", artifact: "combined" };
    const plan = v2Plan(variant, { artifactName: artifactNameV2({ ...BASE, imageVariant: variant }) });
    expect(buildDispatchRequest(plan, { buildId: "b2", artifactName: plan.artifactName }).eventType).toBe(
      "combinewrt-build",
    );
  });

  it("uses the ticket 06 recipe and the source-build event for source plans", () => {
    const plan = sourcePlan();
    const request = buildDispatchRequest(
      plan,
      { buildId: "s1", artifactName: plan.artifactName },
      { now: new Date("2026-01-02T03:04:05.000Z") },
    );

    expect(request.eventType).toBe("combinewrt-source-build");
    const payload = request.payload as SourceDispatchPayload;
    expect(payload.buildId).toBe("s1");
    expect(payload.schemaVersion).toBe(1);
    expect(payload.engine).toBe("source");
    expect(payload.kernelLineId).toBe("6.6");
    expect(payload.expectedKernel).toBe("6.6.159");
    expect(payload.source.ref).toMatch(/^[0-9a-f]{40}$/);
    expect(payload.config).toContain("CONFIG_TARGET_x86_64=y");
    expect(payload.config).toContain("CONFIG_PACKAGE_luci=y");
    expect(payload.feedsConf).toContain("src-git packages");
    expect(payload.metadata.generatedAt).toBe("2026-01-02T03:04:05.000Z");
    // The ImageBuilder payload must never be produced for a source plan.
    expect(payload).not.toHaveProperty("imageBuilderCommand");
  });

  it("refuses an unmodelled source kernel line instead of falling back to ImageBuilder", () => {
    const plan = sourcePlan({ kernelLine: { id: "6.9", version: "6.6", engine: "source" } as never });
    expect(() => buildDispatchRequest(plan, { buildId: "s2", artifactName: plan.artifactName })).toThrow(
      /6\.9/,
    );
    expect(() => buildDispatchRequest(plan, { buildId: "s2", artifactName: plan.artifactName })).toThrow(
      /config\/kernel-lines\.json/,
    );
  });
});
