import { describe, expect, it } from "vitest";
import { loadCapabilities } from "../catalog/capabilities";
import { loadExtensionBundles } from "../extension/bundles";
import { loadExtensionThemes } from "../extension/themes";
import { loadCommonPreset } from "../presets/common";
import { loadSourceRegistry } from "../sources/registry";
import { loadModeDeclarations } from "./modes";
import { createBuildUiOptions, filterTargets, packageApplicability } from "./ui-options";

function options() {
  const registry = loadCapabilities();
  const sourceRegistry = loadSourceRegistry();
  return createBuildUiOptions({
    registry,
    declarations: loadModeDeclarations(),
    bundles: loadExtensionBundles({ registry: sourceRegistry }),
    themes: loadExtensionThemes({ registry: sourceRegistry }),
    common: loadCommonPreset(),
  });
}

const ui = options();
const x86 = ui.targets.find((target) => target.id === "x86/64")!;
const x86Profile = x86.profiles.find((profile) => profile.id === "generic")!;

describe("createBuildUiOptions", () => {
  it("lists the verified target with every declared variant and a readable disabled reason", () => {
    expect(x86.buildable).toBe(true);
    expect(x86Profile.buildable).toBe(true);
    expect(x86Profile.variants).toHaveLength(20);
    const emmc = x86Profile.variants.find((variant) => variant.artifact === "emmc")!;
    expect(emmc.supported).toBe(false);
    expect(emmc.disabledReason).toMatch(/deferred: eMMC|not supported/i);
    const combined = x86Profile.variants.find((variant) => variant.key === "efi/ext4/combined")!;
    expect(combined.supported).toBe(true);
    expect(combined.label).toBe("EFI · ext4 · combined");
  });

  it("marks placeholder targets as not buildable", () => {
    const arm = ui.targets.find((target) => target.id === "mediatek/filogic")!;
    expect(arm.buildable).toBe(false);
    expect(arm.profiles[0].buildable).toBe(false);
    expect(arm.profiles[0].variants.every((variant) => !variant.supported)).toBe(true);
  });

  it("carries mode requirements for the advanced form", () => {
    const docker = x86Profile.modes.find((mode) => mode.id === "docker")!;
    expect(docker.offered).toBe(true);
    expect(docker.requires).toContain("engine:source");
    expect(docker.requires).toContain("filesystem:ext4");
    expect(docker.packages).toContain("dockerd");
    const switchPort = x86Profile.modes.find((mode) => mode.id === "switch-port")!;
    expect(switchPort.exclusiveGroup).toBe("wan-mapping");
  });

  it("ships the curated chips, bundles and themes", () => {
    const chips = ui.commonGroups.reduce((total, group) => total + group.packages.length, 0);
    expect(chips).toBeGreaterThanOrEqual(60);
    expect(ui.bundles.length).toBeGreaterThanOrEqual(10);
    expect(ui.themes.find((theme) => theme.default)?.package).toBe("luci-theme-argon");
    expect(ui.basePresets.map((preset) => preset.id)).toEqual(["minimal", "common", "router-default"]);
    expect(ui.basePresets.find((preset) => preset.id === "router-default")?.features).toContain(
      "feature:dhcp-server",
    );
  });
});

describe("filterTargets", () => {
  it("matches target and profile text", () => {
    expect(filterTargets(ui.targets, { query: "mediatek" }).map((target) => target.id)).toEqual([
      "mediatek/filogic",
    ]);
    expect(filterTargets(ui.targets, { query: "x86" }).map((target) => target.id)).toEqual(["x86/64"]);
  });

  it("restricts by capability and drops non-matching profiles", () => {
    const emmc = filterTargets(ui.targets, { capability: "emmc" });
    expect(emmc.map((target) => target.id)).toEqual(["mediatek/filogic"]);
    const efi = filterTargets(ui.targets, { capability: "efi" });
    expect(efi.map((target) => target.id)).toEqual(["x86/64"]);
    expect(filterTargets(ui.targets, { query: "not-a-thing" })).toEqual([]);
  });
});

describe("packageApplicability", () => {
  const common = loadCommonPreset();
  const registry = loadSourceRegistry();

  it("rejects a curated package outside its target", () => {
    expect(
      packageApplicability("node", {
        common,
        registry,
        targetId: "mediatek/filogic",
        kernelLine: "6.12",
      }),
    ).toEqual({ allowed: false, reason: "策展包 node 仅适用于 x86/64" });
  });

  it("rejects a registry package outside its kernel line", () => {
    const result = packageApplicability("kmod-tun", {
      common,
      registry,
      targetId: "x86/64",
      kernelLine: "6.18",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("6.18");
  });

  it("leaves an unregistered name to the planner", () => {
    expect(
      packageApplicability("zzzz-not-in-catalog", {
        common,
        registry,
        targetId: "x86/64",
        kernelLine: "6.12",
      }),
    ).toEqual({ allowed: true, reason: null });
  });
});
