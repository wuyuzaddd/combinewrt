import { describe, expect, it } from "vitest";
import { artifactNameV2 } from "../build/artifact-name";
import type { BuildPlan, BuildPlanV2 } from "../build/types";
import { EMPTY_SOURCE_PINS } from "../catalog/types";
import type { ImageVariant } from "../domain/types";
import { mapImageVariant } from "../image/variants";
import { buildDispatchPayload, imageBuilderCommandForVariant } from "./dispatch";

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
