import { describe, expect, it } from "vitest";
import { legacyBuildFormToV2Form, LEGACY_V2_DEFAULTS } from "./prepare";
import type { BuildFormInput } from "../build/types";

function legacyForm(overrides: Partial<BuildFormInput> = {}): BuildFormInput {
  return {
    profile: "generic",
    imageType: "ext4-efi",
    hostname: "router",
    timezone: "Asia/Shanghai",
    lanIp: "192.168.1.1",
    netmask: "255.255.255.0",
    rootPassword: "correct horse",
    packages: ["luci"],
    ...overrides,
  };
}

describe("legacyBuildFormToV2Form", () => {
  it("fills the implicit V2 defaults", () => {
    const mapped = legacyBuildFormToV2Form(legacyForm());

    expect(mapped.target).toBe("x86/64");
    expect(mapped.profile).toBe("generic");
    expect(mapped.kernelLine).toBe("6.12");
    expect(mapped.imageVariant).toEqual({ boot: "efi", filesystem: "ext4", artifact: "combined" });
    expect(mapped.basePreset).toBe("minimal");
    expect(mapped.modes).toEqual([]);
    expect(mapped.visibility).toBe("private");
    expect(LEGACY_V2_DEFAULTS).toMatchObject({
      target: "x86/64",
      profile: "generic",
      kernelLine: "6.12",
      basePreset: "minimal",
      visibility: "private",
    });
  });

  it("never forwards the V1 imageType as a planner input", () => {
    const mapped = legacyBuildFormToV2Form(legacyForm());
    expect(mapped).not.toHaveProperty("imageType");
  });

  it("derives the image variant from imageType", () => {
    expect(legacyBuildFormToV2Form(legacyForm({ imageType: "squashfs-efi" })).imageVariant).toEqual({
      boot: "efi",
      filesystem: "squashfs",
      artifact: "combined",
    });
    expect(legacyBuildFormToV2Form(legacyForm({ imageType: "rootfs-tar" })).imageVariant).toEqual({
      boot: "efi",
      filesystem: "squashfs",
      artifact: "rootfs",
    });
  });

  it("preserves the submitted visibility and the package lists", () => {
    const mapped = legacyBuildFormToV2Form(
      legacyForm({
        visibility: "public",
        packages: ["luci", "dnsmasq"],
        removePackages: ["ppp"],
      }),
    );

    expect(mapped.visibility).toBe("public");
    expect(mapped.packages).toEqual(["luci", "dnsmasq"]);
    expect(mapped.removePackages).toEqual(["ppp"]);
  });
});
