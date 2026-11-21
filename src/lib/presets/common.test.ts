import { describe, expect, it } from "vitest";
import {
  COMMON_PRESET_MIN_PACKAGES,
  commonPackageSelectionConflicts,
  commonPresetFilePath,
  loadCommonPreset,
  parseCommonPreset,
  validateCommonPreset,
  type CommonPreset,
} from "./common";

function synthetic(packages: unknown[], overrides: Record<string, unknown> = {}): CommonPreset {
  return parseCommonPreset({
    schemaVersion: 1,
    groups: [{ id: "network", title: "网络", description: "网络工具", packages }],
    ...overrides,
  });
}

describe("common-v2 preset", () => {
  const preset = loadCommonPreset();

  it("curates at least 60 reviewed packages in grouped sections", () => {
    const packages = preset.groups.flatMap((group) => group.packages);
    expect(commonPresetFilePath()).toMatch(/config\/presets\/common-v2\.json$/);
    expect(packages.length).toBeGreaterThanOrEqual(COMMON_PRESET_MIN_PACKAGES);
    expect(preset.groups.length).toBeGreaterThanOrEqual(5);
    expect(new Set(preset.groups.map((group) => group.id)).size).toBe(preset.groups.length);
    expect(new Set(packages.map((pkg) => pkg.name)).size).toBe(packages.length);
  });

  it("completes every field: a Chinese description, a license and a source", () => {
    for (const group of preset.groups) {
      expect(group.title).toMatch(/[\u4e00-\u9fff]/);
      for (const pkg of group.packages) {
        expect(pkg.name).toMatch(/^[A-Za-z0-9][A-Za-z0-9+._-]*$/);
        expect(pkg.description).toMatch(/[\u4e00-\u9fff]/);
        expect(pkg.license).toMatch(/^[A-Za-z0-9][A-Za-z0-9.+-]*$/);
        expect(pkg.license).not.toMatch(/proprietary|unknown/i);
        expect(["official", "dllkids", "supplement", "extension"]).toContain(pkg.source);
      }
    }
  });

  it("keeps themes out of the common package set", () => {
    for (const group of preset.groups) {
      expect(["themes", "theme"]).not.toContain(group.id);
      for (const pkg of group.packages) {
        expect(pkg.name.startsWith("luci-theme-")).toBe(false);
      }
    }
  });

  it("keeps the one-click favorites resolvable and unique", () => {
    const favorites = preset.favorites ?? [];
    const curated = new Set(preset.groups.flatMap((group) => group.packages.map((pkg) => pkg.name)));
    expect(favorites.length).toBeGreaterThan(0);
    expect(new Set(favorites).size).toBe(favorites.length);
    for (const name of favorites) {
      // Themes ship through the extension registry, so they are the only
      // favorites allowed to live outside a curated group.
      expect(curated.has(name) || name.startsWith("luci-theme-")).toBe(true);
    }
  });

  it("rejects a favourite that is neither curated nor a theme", () => {
    const issues = validateCommonPreset({
      schemaVersion: 1,
      favorites: ["luci-app-nope"],
      groups: [
        {
          id: "network",
          title: "网络",
          packages: [
            { name: "luci-app-ddns", source: "official", license: "GPL-2.0-only", description: "动态 DNS 客户端" },
          ],
        },
      ],
    });
    expect(issues.join("\n")).toMatch(/not a curated package/);
  });

  it("rejects a registry that is short, duplicated, malformed or themed", () => {
    const entry = { name: "luci-app-ddns", source: "official", license: "GPL-2.0-only", description: "动态 DNS 客户端" };
    const issues = validateCommonPreset({
      schemaVersion: 1,
      groups: [
        { id: "themes", title: "主题", packages: [entry, { ...entry }] },
        { id: "network", title: "网络", packages: [{ ...entry, name: "luci-theme-bootstrap" }] },
      ],
    });
    const text = issues.join("\n");
    expect(issues.length).toBeGreaterThan(0);
    expect(text).toMatch(/themes|theme/i);
    expect(text).toMatch(/at least 60/i);
    expect(text).toMatch(/duplicate/i);
  });

  it("rejects an entry without a license", () => {
    const issues = validateCommonPreset({
      schemaVersion: 1,
      groups: [
        {
          id: "network",
          title: "网络",
          packages: [{ name: "luci-app-ddns", source: "official", license: "", description: "动态 DNS 客户端" }],
        },
      ],
    });
    expect(issues.join("\n")).toMatch(/license/);
  });

  it("rejects an entry whose description is not Chinese", () => {
    const issues = validateCommonPreset({
      schemaVersion: 1,
      groups: [
        {
          id: "network",
          title: "网络",
          packages: [{ name: "luci-app-ddns", source: "official", license: "MIT", description: "DDNS client" }],
        },
      ],
    });
    expect(issues.join("\n")).toMatch(/description/);
  });

  it("names a curated package that is out of range for the target, with its source", () => {
    const restricted = synthetic([
      {
        name: "demo-restricted",
        source: "official",
        license: "MIT",
        description: "仅适用于联发科目标的演示包",
        targets: ["mediatek/filogic"],
      },
    ]);
    const conflicts = commonPackageSelectionConflicts(restricted, {
      targetId: "x86/64",
      kernelLine: "6.12",
      packages: ["demo-restricted"],
    });

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.names).toEqual(["demo-restricted"]);
    expect(conflicts[0]?.message).toMatch(/demo-restricted/);
    expect(conflicts[0]?.message).toMatch(/official/);
    expect(conflicts[0]?.message).toMatch(/mediatek\/filogic/);
  });

  it("names a curated package that is out of range for the kernel line", () => {
    const restricted = synthetic([
      {
        name: "kmod-demo",
        source: "official",
        license: "GPL-2.0-only",
        description: "仅用于 6.12 内核的演示模块",
        kernelLines: ["6.12"],
      },
    ]);
    const conflicts = commonPackageSelectionConflicts(restricted, {
      targetId: "x86/64",
      kernelLine: "6.6",
      packages: ["kmod-demo"],
    });

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.message).toMatch(/6\.12/);
    expect(conflicts[0]?.message).toMatch(/6\.6/);
  });

  it("accepts a curated package that is in range", () => {
    const universal = synthetic([
      { name: "luci-app-demo", source: "official", license: "MIT", description: "通用演示包" },
    ]);
    expect(
      commonPackageSelectionConflicts(universal, {
        targetId: "x86/64",
        kernelLine: "6.12",
        packages: ["luci-app-demo"],
      }),
    ).toEqual([]);
  });

  it("names both packages and sources when two curated packages conflict", () => {
    const preset = synthetic([
      {
        name: "demo-a",
        source: "official",
        license: "MIT",
        description: "演示包 A",
        conflicts: ["demo-b"],
      },
      { name: "demo-b", source: "dllkids", license: "MIT", description: "演示包 B" },
    ]);
    const conflicts = commonPackageSelectionConflicts(preset, {
      targetId: "x86/64",
      kernelLine: "6.12",
      packages: ["demo-a", "demo-b"],
    });

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.names.sort()).toEqual(["demo-a", "demo-b"]);
    expect(conflicts[0]?.message).toMatch(/official/);
    expect(conflicts[0]?.message).toMatch(/dllkids/);
  });

  it("names the package and both sources when the catalog disagrees with the curated source", () => {
    const preset = synthetic([
      { name: "luci", source: "official", license: "MIT", description: "LuCI 网页界面" },
    ]);
    const conflicts = commonPackageSelectionConflicts(preset, {
      targetId: "x86/64",
      kernelLine: "6.12",
      packages: ["luci"],
      resolvedSources: new Map([["luci", "dllkids"]]),
    });

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.message).toMatch(/official/);
    expect(conflicts[0]?.message).toMatch(/dllkids/);
  });
});
