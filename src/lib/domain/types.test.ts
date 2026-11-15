import { describe, expect, it } from "vitest";
import {
  DEFAULT_KERNEL_LINE_ID,
  DEFAULT_TARGET,
  DEFAULT_TARGET_ID,
  EXPERIMENTAL_KERNEL_LINE_IDS,
  KERNEL_LINE_VERSIONS,
  type DeviceProfile,
  type ImageVariant,
  type KernelLine,
  type ModeRef,
  type Target,
} from "./types";

describe("V2 domain model", () => {
  it("pins the V1-compatible x86/64 default target", () => {
    const target: Target = DEFAULT_TARGET;
    expect(target.id).toBe(DEFAULT_TARGET_ID);
    expect(target).toMatchObject({ id: "x86/64", architecture: "x86_64", subtarget: "generic" });
    expect(target.title.length).toBeGreaterThan(0);
  });

  it("defaults to the 6.12 kernel line and marks 6.6 / 6.18 experimental", () => {
    expect(KERNEL_LINE_VERSIONS).toEqual(["6.6", "6.12", "6.18"]);
    expect(DEFAULT_KERNEL_LINE_ID).toBe("6.12");
    expect(EXPERIMENTAL_KERNEL_LINE_IDS).toEqual(["6.6", "6.18"]);

    const line: KernelLine = { id: "6.12", version: "6.12", engine: "imagebuilder" };
    expect(line.version).toBe("6.12");
  });

  it("describes an image variant across boot, filesystem, artifact and overlay size", () => {
    const variant: ImageVariant = {
      boot: "efi",
      filesystem: "squashfs",
      artifact: "combined",
      overlaySizeMb: 1024,
    };
    expect(variant).toMatchObject({ boot: "efi", filesystem: "squashfs", artifact: "combined" });
  });

  it("keeps a device profile scoped to its target and a mode ref scoped to its layer", () => {
    const profile: DeviceProfile = {
      targetId: DEFAULT_TARGET_ID,
      id: "generic",
      title: "Generic x86/64",
      capabilities: ["efi", "squashfs"],
    };
    const ref: ModeRef = { id: "base-preset", layer: "file/board", title: "Base preset" };
    expect(profile.targetId).toBe("x86/64");
    expect(ref.layer).toBe("file/board");
  });
});
