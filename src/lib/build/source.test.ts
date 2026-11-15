import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateCapabilities } from "../catalog/capabilities";
import type { BuildPlanV2 } from "../domain/build-plan";
import type { SourceKernelLine } from "./source";
import { generateSourceRecipe, parseKernelLineRegistry, validateKernelLineRegistry } from "./source";

const repoRoot = process.cwd();
const rawRegistry = JSON.parse(readFileSync(resolve(repoRoot, "config/kernel-lines.json"), "utf8")) as unknown;
const registry = parseKernelLineRegistry(rawRegistry);
const sourceLine = (id: string): SourceKernelLine => {
  const line = registry.lines.find((candidate) => candidate.id === id);
  if (!line || line.engine !== "source") throw new Error(`missing source kernel line ${id}`);
  return line;
};
const line66 = sourceLine("6.6");
const fragment66 = readFileSync(resolve(repoRoot, line66.source.configFragment), "utf8");

interface MutableLine {
  id: string;
  version: string;
  engine: string;
  experimental: boolean;
  source?: { ref: string; expectedKernel: string; configFragment: string; feeds: { name: string; ref: string }[] };
}

interface MutableRegistry {
  schemaVersion: number;
  unwantedVersions: string[];
  lines: MutableLine[];
}

function cloneRegistry(): MutableRegistry {
  return JSON.parse(JSON.stringify(rawRegistry)) as MutableRegistry;
}

function planV2(overrides: Record<string, unknown> = {}): BuildPlanV2 {
  return {
    schemaVersion: 2,
    baseVersion: "24.10-SNAPSHOT",
    channel: "snapshot",
    target: { id: "x86/64" },
    deviceProfile: { id: "generic", title: "Generic x86/64" },
    kernelLine: { id: "6.6", version: "6.6", engine: "source", sourceRecipeRef: "config/kernel/6.6.config" },
    imageVariant: { boot: "efi", filesystem: "ext4", artifact: "combined" },
    basePreset: { id: "minimal", layer: "file/board" },
    overlays: [],
    engine: "source",
    topLevelPackages: ["luci", "curl"],
    artifactName: "immortalwrt-24.10-SNAPSHOT-x86-64-generic-ext4-combined-efi.img.gz",
    profileId: "generic",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as unknown as BuildPlanV2;
}

const modeFragment = { id: "luci", content: "\n# luci mode\nCONFIG_PACKAGE_luci-app-firewall=y\n" };
const now = new Date("2026-01-02T03:04:05.000Z");

describe("kernel line registry", () => {
  it("parses the checked-in registry pinned to real 40-hex commits", () => {
    expect(registry.schemaVersion).toBe(1);
    expect(registry.unwantedVersions).toEqual(["5.15", "6.1"]);
    expect(registry.lines.map((line) => line.id)).toEqual(["6.6", "6.12", "6.18"]);

    expect(line66.source.ref).toBe("af0775ab50d2d0e41f4e558c59208f6c9b8bdf0b");
    expect(line66.source.branch).toBe("openwrt-24.10");
    expect(line66.source.expectedKernel).toBe("6.6.159");
    expect(line66.source.kernelVersionFile).toBe("include/kernel-6.6");
    expect(line66.source.feeds.map((feed) => feed.name)).toEqual(["packages", "luci", "routing", "telephony"]);

    const line612 = registry.lines.find((line) => line.id === "6.12");
    expect(line612?.engine).toBe("imagebuilder");

    const line618 = sourceLine("6.18");
    expect(line618.source.ref).toBe("a4ba8240d8a1aaef7e8c6f2d65e841a9bfd2b8c5");
    expect(line618.source.branch).toBe("master");
    expect(line618.source.expectedKernel).toBe("6.18.60");
  });

  it("stays in sync with the capability registry", () => {
    const capabilities = JSON.parse(readFileSync(resolve(repoRoot, "config/capabilities/targets.json"), "utf8")) as {
      kernelLines: { id: string; version: string; engine: string; experimental: boolean; sourceRecipeRef?: string }[];
    };
    expect(validateCapabilities(capabilities)).toEqual([]);

    for (const capability of capabilities.kernelLines) {
      const line = registry.lines.find((candidate) => candidate.id === capability.id);
      expect(line).toBeDefined();
      expect(line?.version).toBe(capability.version);
      expect(line?.engine).toBe(capability.engine);
      expect(line?.experimental).toBe(capability.experimental);
      if (line?.engine === "source") {
        expect(line.source.configFragment).toBe(capability.sourceRecipeRef);
      }
    }
    expect(capabilities.kernelLines.some((line) => line.version === "5.15" || line.version === "6.1")).toBe(false);
  });

  it("rejects a branch name where a 40-hex commit belongs", () => {
    const bad = cloneRegistry();
    bad.lines[0]!.source!.ref = "openwrt-24.10";
    expect(validateKernelLineRegistry(bad).join("\n")).toMatch(/40-character/i);
  });

  it("rejects unpinned feeds", () => {
    const bad = cloneRegistry();
    bad.lines[0]!.source!.feeds[0]!.ref = "171d5f9";
    expect(validateKernelLineRegistry(bad).join("\n")).toMatch(/feed "packages"/);
  });

  it("rejects an engine that contradicts the kernel line policy", () => {
    const bad = cloneRegistry();
    const line612 = bad.lines.find((line) => line.id === "6.12")!;
    line612.engine = "source";
    line612.source = { ref: "a".repeat(40), expectedKernel: "6.12.1", configFragment: "config/kernel/6.12.config", feeds: [] };
    const violations = validateKernelLineRegistry(bad).join("\n");
    expect(violations).toMatch(/6\.12/);
    expect(violations).toMatch(/imagebuilder/);
  });

  it("keeps kernel 5.15 and 6.1 unwanted", () => {
    const bad = cloneRegistry();
    bad.lines.push({ id: "5.15", version: "5.15", engine: "imagebuilder", experimental: false });
    expect(validateKernelLineRegistry(bad).join("\n")).toMatch(/5\.15/);
  });

  it("rejects duplicate lines and several other malformed shapes", () => {
    const duplicate = cloneRegistry();
    duplicate.lines.push({ id: "6.6", version: "6.6", engine: "imagebuilder", experimental: false });
    expect(validateKernelLineRegistry(duplicate).join("\n")).toMatch(/duplicate/i);

    const wrongSchema = cloneRegistry();
    wrongSchema.schemaVersion = 2;
    expect(validateKernelLineRegistry(wrongSchema).join("\n")).toMatch(/schemaVersion/);

    const imagebuilderWithSource = cloneRegistry();
    imagebuilderWithSource.lines[1]!.source = { ref: "b".repeat(40), expectedKernel: "6.12.1", configFragment: "config/kernel/6.12.config", feeds: [] };
    expect(validateKernelLineRegistry(imagebuilderWithSource).join("\n")).toMatch(/imagebuilder kernel line "6\.12" must not declare source/);
  });

  it("throws a readable error from parse when the registry is invalid", () => {
    const bad = cloneRegistry();
    bad.lines = bad.lines.filter((line) => line.id !== "6.18");
    expect(() => parseKernelLineRegistry(bad)).toThrow(/kernel line 6\.18 is missing/);
  });
});

describe("generateSourceRecipe", () => {
  it("generates a reviewable x86/64 .config, feeds.conf and package list", () => {
    const plan = planV2({ overlays: [{ id: "luci", layer: "package/kernel" }] });
    const recipe = generateSourceRecipe({ plan, line: line66, fragment: fragment66, modeFragments: [modeFragment], now });

    expect(recipe.config).toContain("# Generated by combinewrt source.ts for kernel line 6.6");
    expect(recipe.config).toContain(`# Source: ${line66.source.repo}@${line66.source.ref} (openwrt-24.10)`);
    expect(recipe.config).toContain("CONFIG_TARGET_x86=y");
    expect(recipe.config).toContain("CONFIG_TARGET_x86_64=y");
    expect(recipe.config).toContain("CONFIG_TARGET_IMAGES_GZIP=y");
    expect(recipe.config).toContain("CONFIG_TARGET_ROOTFS_EXT4FS=y");
    expect(recipe.config).toContain("# CONFIG_TARGET_ROOTFS_SQUASHFS is not set");
    expect(recipe.config).toContain("CONFIG_GRUB_EFI_IMAGES=y");
    expect(recipe.config).toContain("# CONFIG_GRUB_IMAGES is not set");
    expect(recipe.config).toContain("CONFIG_PACKAGE_luci=y");
    expect(recipe.config).toContain("CONFIG_PACKAGE_curl=y");
    expect(recipe.config).toContain("CONFIG_PACKAGE_luci-app-firewall=y");
    expect(recipe.config).toContain("CONFIG_TARGET_ROOTFS_PARTSIZE=300");
    expect(recipe.config).not.toContain("CONFIG_TARGET_MULTI_PROFILE");

    expect(recipe.feedsConf).toBe(
      [
        `src-git packages ${line66.source.feeds[0]!.repo}^${line66.source.feeds[0]!.ref}`,
        `src-git luci ${line66.source.feeds[1]!.repo}^${line66.source.feeds[1]!.ref}`,
        `src-git routing ${line66.source.feeds[2]!.repo}^${line66.source.feeds[2]!.ref}`,
        `src-git telephony ${line66.source.feeds[3]!.repo}^${line66.source.feeds[3]!.ref}`,
        "",
      ].join("\n"),
    );
    expect(recipe.packages).toEqual(["luci", "curl"]);
    expect(recipe.configChecks).toEqual(
      expect.arrayContaining([
        "CONFIG_TARGET_x86=y",
        "CONFIG_TARGET_x86_64=y",
        "CONFIG_TARGET_ROOTFS_EXT4FS=y",
        "CONFIG_GRUB_EFI_IMAGES=y",
        "CONFIG_PACKAGE_luci=y",
        "CONFIG_PACKAGE_curl=y",
      ]),
    );
    expect(recipe.profileChecks).toEqual([
      "CONFIG_TARGET_x86_64_Generic=y",
      "CONFIG_TARGET_DEVICE_x86_64_DEVICE_generic=y",
    ]);
    expect(recipe.imageGlob).toBe("*-ext4-combined-efi.img.gz");
    expect(recipe.artifactName).toBe("immortalwrt-24.10-SNAPSHOT-x86-64-generic-ext4-combined-efi.img.gz");
    expect(recipe.kernelLineId).toBe("6.6");
    expect(recipe.kernelVersion).toBe("6.6");
    expect(recipe.expectedKernel).toBe("6.6.159");
    expect(recipe.source).toEqual({
      repo: "https://github.com/immortalwrt/immortalwrt.git",
      ref: "af0775ab50d2d0e41f4e558c59208f6c9b8bdf0b",
      branch: "openwrt-24.10",
    });
    expect(recipe.metadata.kernelLine.expectedKernel).toBe("6.6.159");
    expect(recipe.metadata.generatedAt).toBe("2026-01-02T03:04:05.000Z");
    expect(recipe.metadata.feeds).toEqual(line66.source.feeds);
    expect(recipe.metadata.patches).toEqual([]);
  });

  it("lets later fragments and the generated variant block override earlier values", () => {
    const fragment = `${fragment66}\nCONFIG_TARGET_ROOTFS_PARTSIZE=111\nCONFIG_GRUB_IMAGES=y\n`;
    const override = { id: "luci", content: "CONFIG_TARGET_ROOTFS_PARTSIZE=222\n" };
    const recipe = generateSourceRecipe({
      plan: planV2({ overlays: [{ id: "luci", layer: "package/kernel" }] }),
      line: line66,
      fragment,
      modeFragments: [override],
      now,
    });

    expect(recipe.config).toContain("CONFIG_TARGET_ROOTFS_PARTSIZE=222");
    expect(recipe.config).not.toContain("CONFIG_TARGET_ROOTFS_PARTSIZE=111");
    expect(recipe.config).not.toContain("CONFIG_TARGET_ROOTFS_PARTSIZE=300");
    expect(recipe.config).not.toContain("CONFIG_GRUB_IMAGES=y");
    expect(recipe.config.match(/CONFIG_GRUB_IMAGES is not set/g)).toHaveLength(1);
  });

  it("builds a squashfs legacy combined configuration", () => {
    const recipe = generateSourceRecipe({
      plan: planV2({ imageVariant: { boot: "legacy", filesystem: "squashfs", artifact: "combined" } }),
      line: line66,
      fragment: fragment66,
      now,
    });

    expect(recipe.config).toContain("CONFIG_TARGET_ROOTFS_SQUASHFS=y");
    expect(recipe.config).toContain("# CONFIG_TARGET_ROOTFS_EXT4FS is not set");
    expect(recipe.config).toContain("CONFIG_GRUB_IMAGES=y");
    expect(recipe.config).toContain("# CONFIG_GRUB_EFI_IMAGES is not set");
    expect(recipe.imageGlob).toBe("*-squashfs-combined.img.gz");
  });

  it("builds rootfs and virtual-disk variants", () => {
    const rootfs = generateSourceRecipe({
      plan: planV2({ imageVariant: { boot: "efi", filesystem: "ext4", artifact: "rootfs" } }),
      line: line66,
      fragment: fragment66,
      now,
    });
    expect(rootfs.imageGlob).toBe("*-rootfs.img.gz");
    expect(rootfs.config).toContain("# CONFIG_GRUB_IMAGES is not set");
    expect(rootfs.config).toContain("# CONFIG_GRUB_EFI_IMAGES is not set");

    const vmdk = generateSourceRecipe({
      plan: planV2({ imageVariant: { boot: "legacy", filesystem: "ext4", artifact: "vmdk" } }),
      line: line66,
      fragment: fragment66,
      now,
    });
    expect(vmdk.imageGlob).toBe("*-ext4-combined.vmdk");
    expect(vmdk.config).toContain("CONFIG_VMDK_IMAGES=y");
    expect(vmdk.config).toContain("# CONFIG_QCOW2_IMAGES is not set");

    const qcow2 = generateSourceRecipe({
      plan: planV2({ imageVariant: { boot: "efi", filesystem: "ext4", artifact: "qcow2" } }),
      line: line66,
      fragment: fragment66,
      now,
    });
    expect(qcow2.imageGlob).toBe("*-ext4-combined-efi.qcow2");
    expect(qcow2.config).toContain("CONFIG_QCOW2_IMAGES=y");
  });

  it("is deterministic", () => {
    const input = { plan: planV2({ overlays: [{ id: "luci", layer: "package/kernel" }] }), line: line66, fragment: fragment66, modeFragments: [modeFragment], now };
    expect(generateSourceRecipe(input)).toEqual(generateSourceRecipe(input));
  });

  it("refuses plans and recipes that would leave the controlled build path", () => {
    expect(() =>
      generateSourceRecipe({ plan: planV2({ engine: "imagebuilder" }), line: line66, fragment: fragment66, now }),
    ).toThrow(/source engine/i);

    expect(() =>
      generateSourceRecipe({
        plan: planV2({ kernelLine: { id: "6.12", version: "6.12", engine: "imagebuilder" } }),
        line: line66,
        fragment: fragment66,
        now,
      }),
    ).toThrow(/6\.12/);

    expect(() =>
      generateSourceRecipe({ plan: planV2({ target: { id: "mediatek/filogic" } }), line: line66, fragment: fragment66, now }),
    ).toThrow(/x86\/64/);

    expect(() =>
      generateSourceRecipe({
        plan: planV2({ imageVariant: { boot: "efi", filesystem: "ext4", artifact: "emmc" } }),
        line: line66,
        fragment: fragment66,
        now,
      }),
    ).toThrow(/emmc/);

    expect(() =>
      generateSourceRecipe({ plan: planV2({ topLevelPackages: ["luci; rm -rf /"] }), line: line66, fragment: fragment66, now }),
    ).toThrow(/package/i);

    expect(() =>
      generateSourceRecipe({ plan: planV2({ overlays: [{ id: "docker", layer: "package/kernel" }] }), line: line66, fragment: fragment66, now }),
    ).toThrow(/docker/);

    const imagebuilderLine = registry.lines.find((line) => line.id === "6.12") as unknown as SourceKernelLine;
    expect(() =>
      generateSourceRecipe({ plan: planV2(), line: imagebuilderLine, fragment: fragment66, now }),
    ).toThrow(/source kernel line/i);
  });
});
