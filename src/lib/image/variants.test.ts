import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadCapabilities } from "../catalog/capabilities";
import type { ImageVariant } from "../domain/types";
import {
  ImageVariantError,
  mapImageVariant,
  mapSupportedImageVariant,
  resolveImageVariant,
} from "./variants";

const upstream = JSON.parse(
  readFileSync(new URL("../catalog/fixtures/profiles-x86-64.json", import.meta.url), "utf8"),
) as { profiles: { generic: { images: Array<{ name: string }> } } };
const upstreamNames = upstream.profiles.generic.images.map((image) => image.name);

const registry = loadCapabilities();

const BASE = {
  baseVersion: "25.12.2",
  targetId: "x86/64",
  profileId: "generic",
} as const;

function map(variant: ImageVariant) {
  return mapImageVariant({ ...BASE, variant });
}

function configOf(variant: ImageVariant): Record<string, string> {
  return map(variant).config;
}

describe("mapImageVariant artifact naming", () => {
  it("names combined artifacts after the upstream ImageBuilder products", () => {
    expect(map({ boot: "efi", filesystem: "ext4", artifact: "combined" }).artifactName).toBe(
      "immortalwrt-25.12.2-x86-64-generic-ext4-combined-efi.img.gz",
    );
    expect(map({ boot: "legacy", filesystem: "ext4", artifact: "combined" }).artifactName).toBe(
      "immortalwrt-25.12.2-x86-64-generic-ext4-combined.img.gz",
    );
    expect(map({ boot: "efi", filesystem: "squashfs", artifact: "combined" }).artifactName).toBe(
      "immortalwrt-25.12.2-x86-64-generic-squashfs-combined-efi.img.gz",
    );
    expect(map({ boot: "legacy", filesystem: "squashfs", artifact: "combined" }).artifactName).toBe(
      "immortalwrt-25.12.2-x86-64-generic-squashfs-combined.img.gz",
    );
  });

  it("keeps the V1 boot-independent rootfs tarball name", () => {
    for (const boot of ["efi", "legacy"] as const) {
      for (const filesystem of ["ext4", "squashfs"] as const) {
        expect(map({ boot, filesystem, artifact: "rootfs" }).artifactName).toBe(
          "immortalwrt-25.12.2-x86-64-generic-targz-rootfs.tar.gz",
        );
      }
    }
  });

  it("names converted artifacts after the combined source they derive from", () => {
    expect(map({ boot: "efi", filesystem: "ext4", artifact: "vmdk" }).artifactName).toBe(
      "immortalwrt-25.12.2-x86-64-generic-ext4-combined-efi.vmdk",
    );
    expect(map({ boot: "legacy", filesystem: "squashfs", artifact: "qcow2" }).artifactName).toBe(
      "immortalwrt-25.12.2-x86-64-generic-squashfs-combined.qcow2",
    );
    expect(map({ boot: "efi", filesystem: "ext4", artifact: "vmdk" }).sourceArtifactName).toBe(
      "immortalwrt-25.12.2-x86-64-generic-ext4-combined-efi.img.gz",
    );
  });

  it("gives every boot/filesystem artifact a distinct file name", () => {
    const names = new Set<string>();
    for (const boot of ["efi", "legacy"] as const) {
      for (const filesystem of ["ext4", "squashfs"] as const) {
        for (const artifact of ["combined", "vmdk", "qcow2"] as const) {
          names.add(map({ boot, filesystem, artifact }).artifactName);
        }
      }
    }
    expect(names.size).toBe(12);

    // eMMC is boot independent, like the rootfs tarball: the first ARM target
    // that enables it owns the real product recipe.
    expect(map({ boot: "efi", filesystem: "ext4", artifact: "emmc" }).artifactName).toBe(
      map({ boot: "legacy", filesystem: "ext4", artifact: "emmc" }).artifactName,
    );
  });

  it("produces names the upstream ImageBuilder actually writes", () => {
    for (const boot of ["efi", "legacy"] as const) {
      for (const filesystem of ["ext4", "squashfs"] as const) {
        for (const artifact of ["combined", "vmdk", "qcow2"] as const) {
          const mapping = map({ boot, filesystem, artifact });
          expect(upstreamNames).toContain(mapping.artifactName);
          for (const product of mapping.products) expect(upstreamNames).toContain(product);
        }
        expect(upstreamNames).toContain(map({ boot, filesystem, artifact: "rootfs" }).artifactName);
      }
    }
  });

  it("places products under the target directory", () => {
    const mapping = map({ boot: "efi", filesystem: "ext4", artifact: "combined" });

    expect(mapping.productDir).toBe("bin/targets/x86/64");
    expect(mapping.artifactPath).toBe(
      "bin/targets/x86/64/immortalwrt-25.12.2-x86-64-generic-ext4-combined-efi.img.gz",
    );
    expect(mapping.products).toEqual([mapping.artifactName]);
  });
});

describe("mapImageVariant ImageBuilder configuration", () => {
  it("selects the EFI or Legacy boot image recipe", () => {
    expect(configOf({ boot: "efi", filesystem: "ext4", artifact: "combined" })).toMatchObject({
      CONFIG_GRUB_EFI_IMAGES: "y",
      CONFIG_GRUB_IMAGES: "n",
    });
    expect(configOf({ boot: "legacy", filesystem: "ext4", artifact: "combined" })).toMatchObject({
      CONFIG_GRUB_EFI_IMAGES: "n",
      CONFIG_GRUB_IMAGES: "y",
    });
  });

  it("selects the requested root filesystem", () => {
    expect(configOf({ boot: "efi", filesystem: "ext4", artifact: "combined" })).toMatchObject({
      CONFIG_TARGET_ROOTFS_EXT4FS: "y",
      CONFIG_TARGET_ROOTFS_SQUASHFS: "n",
    });
    expect(configOf({ boot: "efi", filesystem: "squashfs", artifact: "combined" })).toMatchObject({
      CONFIG_TARGET_ROOTFS_EXT4FS: "n",
      CONFIG_TARGET_ROOTFS_SQUASHFS: "y",
    });
  });

  it("keeps gzip on and unsupported image products off", () => {
    expect(configOf({ boot: "efi", filesystem: "ext4", artifact: "combined" })).toMatchObject({
      CONFIG_TARGET_IMAGES_GZIP: "y",
      CONFIG_ISO_IMAGES: "n",
      CONFIG_VDI_IMAGES: "n",
      CONFIG_VHDX_IMAGES: "n",
      CONFIG_VMDK_IMAGES: "n",
      CONFIG_QCOW2_IMAGES: "n",
    });
  });

  it("asks for the rootfs tarball only on the rootfs variant", () => {
    expect(configOf({ boot: "efi", filesystem: "ext4", artifact: "rootfs" })).toMatchObject({
      CONFIG_TARGET_ROOTFS_TARGZ: "y",
    });
    expect(configOf({ boot: "efi", filesystem: "ext4", artifact: "combined" })).toMatchObject({
      CONFIG_TARGET_ROOTFS_TARGZ: "n",
    });
  });

  it("maps an ext4 overlay size to CONFIG_TARGET_ROOTFS_PARTSIZE", () => {
    const mapping = map({
      boot: "efi",
      filesystem: "ext4",
      artifact: "combined",
      overlaySizeMb: 2048,
    });

    expect(mapping.config.CONFIG_TARGET_ROOTFS_PARTSIZE).toBe("2048");
    expect(mapping.overlay).toEqual({
      sizeMb: 2048,
      source: "variant",
      configKey: "CONFIG_TARGET_ROOTFS_PARTSIZE",
    });
  });

  it("leaves squashfs overlay sizing to the target capability", () => {
    const mapping = map({
      boot: "legacy",
      filesystem: "squashfs",
      artifact: "combined",
      overlaySizeMb: 2048,
    });

    expect(mapping.config).not.toHaveProperty("CONFIG_TARGET_ROOTFS_PARTSIZE");
    expect(mapping.overlay).toEqual({ sizeMb: 2048, source: "variant" });
  });

  it("never maps an overlay on a rootfs tarball", () => {
    const mapping = map({ boot: "efi", filesystem: "ext4", artifact: "rootfs", overlaySizeMb: 512 });

    expect(mapping.config).not.toHaveProperty("CONFIG_TARGET_ROOTFS_PARTSIZE");
    expect(mapping.overlay).toEqual({ sizeMb: undefined, source: "none" });
  });

  it("emits init commands from the configuration in a stable order", () => {
    const mapping = map({ boot: "efi", filesystem: "ext4", artifact: "combined", overlaySizeMb: 1024 });

    expect(mapping.initCommands[0]).toBe("CONFIG_TARGET_IMAGES_GZIP=y");
    expect(mapping.initCommands).toContain("CONFIG_GRUB_EFI_IMAGES=y");
    expect(mapping.initCommands).toContain("CONFIG_TARGET_ROOTFS_PARTSIZE=1024");
    expect(mapping.initCommands).toHaveLength(Object.keys(mapping.config).length);
    expect(mapping.makeTargets).toEqual(["image"]);
  });
});

describe("mapImageVariant postprocessing", () => {
  it("plans qemu-img conversion from the raw combined image for VMDK and qcow2", () => {
    const vmdk = map({ boot: "efi", filesystem: "ext4", artifact: "vmdk" });
    expect(vmdk.postprocess).toMatchObject({
      kind: "vmdk",
      sourceFormat: "raw",
      sourcePath: "bin/targets/x86/64/immortalwrt-25.12.2-x86-64-generic-ext4-combined-efi.img.gz",
      outputPath: "bin/targets/x86/64/immortalwrt-25.12.2-x86-64-generic-ext4-combined-efi.vmdk",
    });
    expect(vmdk.postprocess?.steps.at(-1)).toMatchObject({
      command: "qemu-img",
      args: expect.arrayContaining(["convert", "-f", "raw", "-O", "vmdk"]),
    });
    expect(vmdk.products).toEqual([vmdk.sourceArtifactName]);

    const qcow2 = map({ boot: "legacy", filesystem: "squashfs", artifact: "qcow2" });
    expect(qcow2.postprocess?.kind).toBe("qcow2");
    expect(qcow2.postprocess?.steps.at(-1)?.args).toContain("qcow2");
  });

  it("has no postprocess step for combined, rootfs or eMMC artifacts", () => {
    for (const artifact of ["combined", "rootfs", "emmc"] as const) {
      expect(map({ boot: "efi", filesystem: "ext4", artifact }).postprocess).toBeUndefined();
    }
  });

  it("produces the eMMC image name only through the capability-gated helper", () => {
    expect(map({ boot: "efi", filesystem: "ext4", artifact: "emmc" }).artifactName).toBe(
      "immortalwrt-25.12.2-x86-64-generic-ext4-emmc.img.gz",
    );
    expect(() =>
      mapSupportedImageVariant({
        baseVersion: BASE.baseVersion,
        profileRef: { targetId: "x86/64", id: "generic" },
        kernelLine: "6.12",
        variant: { boot: "efi", filesystem: "ext4", artifact: "emmc" },
        registry,
      }),
    ).toThrow(ImageVariantError);
  });
});

describe("mapSupportedImageVariant", () => {
  function supported(
    variant: ImageVariant,
    profileRef = { targetId: "x86/64", id: "generic" },
    kernelLine = "6.12",
  ) {
    return mapSupportedImageVariant({
      baseVersion: BASE.baseVersion,
      profileRef,
      kernelLine,
      variant,
      registry,
    });
  }

  it("applies the declared overlay default when the request omits one", () => {
    const mapping = supported({ boot: "efi", filesystem: "ext4", artifact: "combined" });

    expect(mapping.variant.overlaySizeMb).toBe(1024);
    expect(mapping.overlay).toEqual({
      sizeMb: 1024,
      source: "profile-default",
      configKey: "CONFIG_TARGET_ROOTFS_PARTSIZE",
    });
    expect(mapping.config.CONFIG_TARGET_ROOTFS_PARTSIZE).toBe("1024");
  });

  it("rejects overlay sizes outside the declared capability range with a readable error", () => {
    for (const overlaySizeMb of [0, 20_000, 1000]) {
      expect(() =>
        supported({ boot: "efi", filesystem: "ext4", artifact: "combined", overlaySizeMb }),
      ).toThrowError(ImageVariantError);
    }

    try {
      supported({ boot: "efi", filesystem: "ext4", artifact: "combined", overlaySizeMb: 1000 });
    } catch (error) {
      expect(error).toBeInstanceOf(ImageVariantError);
      const variantError = error as ImageVariantError;
      expect(variantError.code).toBe("variant-unsupported");
      expect(variantError.message).toMatch(/overlay size 1000/i);
      expect(variantError.message).toMatch(/256/);
    }
  });

  it("rejects an eMMC artifact with the capability registry's reason", () => {
    try {
      supported({ boot: "legacy", filesystem: "squashfs", artifact: "emmc" });
    } catch (error) {
      const variantError = error as ImageVariantError;
      expect(variantError.code).toBe("variant-unsupported");
      expect(variantError.message).toMatch(/emmc/);
      expect(variantError.message).toMatch(/not supported/i);
    }
  });
});

describe("resolveImageVariant", () => {
  it("drops the overlay from rootfs and defaults one everywhere else", () => {
    expect(resolveImageVariant({ boot: "efi", filesystem: "ext4", artifact: "rootfs" }, 1024)).toEqual({
      boot: "efi",
      filesystem: "ext4",
      artifact: "rootfs",
    });
    expect(resolveImageVariant({ boot: "efi", filesystem: "ext4", artifact: "combined" }, 1024)).toMatchObject({
      overlaySizeMb: 1024,
    });
    expect(
      resolveImageVariant({ boot: "efi", filesystem: "ext4", artifact: "combined", overlaySizeMb: 512 }, 1024),
    ).toMatchObject({ overlaySizeMb: 512 });
  });
});
