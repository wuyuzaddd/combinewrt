import { describe, expect, it } from "vitest";
import { ESSENTIAL_PACKAGES, isEssentialPackage } from "./essentials";
import { applyPackageRemovals, findRemovalDependencyConflicts } from "./removal";
import type { PackageLookup, PackageLookupEntry, RequestedPackage, ResolvedEntry } from "./types";

function lookupEntry(name: string, overrides: Partial<PackageLookupEntry> = {}): PackageLookupEntry {
  return {
    version: "1",
    depends: [],
    source: "official",
    sourcePin: "",
    sha256: null,
    filename: `${name}-1.apk`,
    downloadUrl: null,
    feed: "packages",
    license: "MIT",
    proprietary: false,
    ...overrides,
  };
}

function resolvedEntry(name: string, overrides: Partial<ResolvedEntry> = {}): ResolvedEntry {
  return {
    name,
    version: "1",
    source: "selected",
    packageSource: "official",
    sourcePin: "",
    sha256: null,
    feed: "packages",
    ...overrides,
  };
}

const requested: RequestedPackage[] = [{ name: "luci" }, { name: "luci-base" }, { name: "luci-app-demo" }];

describe("essentials", () => {
  it("protects the factory packages a build cannot boot without", () => {
    for (const name of ["libc", "kernel", "base-files", "busybox"]) {
      expect(ESSENTIAL_PACKAGES).toContain(name);
      expect(isEssentialPackage(name)).toBe(true);
      expect(isEssentialPackage(`official/${name}`)).toBe(true);
    }
    expect(isEssentialPackage("luci")).toBe(false);
    expect(isEssentialPackage("kmod-usb-storage")).toBe(false);
  });
});

describe("applyPackageRemovals", () => {
  it("removes a selected package from the positive list", () => {
    const result = applyPackageRemovals({ requested, removals: ["luci-base"] });

    expect(result.requests.map((item) => item.name)).toEqual(["luci", "luci-app-demo"]);
    expect(result.removed).toEqual(["luci-base"]);
    expect(result.conflicts).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("protects essentials and names each rejected package", () => {
    const result = applyPackageRemovals({ requested, removals: ["libc", "busybox"] });

    expect(result.requests).toEqual(requested);
    expect(result.conflicts).toHaveLength(2);
    expect(result.conflicts.map((conflict) => conflict.names[0]).sort()).toEqual(["busybox", "libc"]);
    expect(result.conflicts[0]?.message).toMatch(/基础包|essentials/);
  });

  it("rejects a malformed name in the negative list", () => {
    const result = applyPackageRemovals({ requested, removals: ["bad name; rm -rf /"] });

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.names).toEqual(["bad name; rm -rf /"]);
    expect(result.conflicts[0]?.message).toMatch(/包名/);
  });

  it("refuses to remove a package a mode supplies and names both", () => {
    const result = applyPackageRemovals({
      requested,
      removals: ["dockerd"],
      modePackages: [{ name: "dockerd", mode: "docker" }],
    });

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.names.sort()).toEqual(["docker", "dockerd"]);
    expect(result.conflicts[0]?.message).toMatch(/docker/);
  });

  it("warns instead of failing when the package is not in the plan", () => {
    const result = applyPackageRemovals({ requested, removals: ["ghost"] });

    expect(result.conflicts).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/ghost/);
    expect(result.requests).toEqual(requested);
  });
});

describe("findRemovalDependencyConflicts", () => {
  const lookup: PackageLookup = (name) => {
    const entries: Record<string, PackageLookupEntry> = {
      luci: lookupEntry("luci", { depends: ["luci-base", "libc"], feed: "luci" }),
      "luci-base": lookupEntry("luci-base", { depends: ["libc"] }),
      libc: lookupEntry("libc"),
    };
    return entries[name] ?? null;
  };

  it("names a removed package and the selected package that still needs it", () => {
    const conflicts = findRemovalDependencyConflicts({
      removals: ["luci-base"],
      requests: [{ name: "luci" }],
      entries: [resolvedEntry("luci"), resolvedEntry("luci-base", { source: "dependency" }), resolvedEntry("libc")],
      lookup,
    });

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.names.sort()).toEqual(["luci", "luci-base"]);
    expect(conflicts[0]?.message).toMatch(/luci-base/);
    expect(conflicts[0]?.message).toMatch(/luci/);
    expect(conflicts[0]?.message).toMatch(/official/);
  });

  it("stays quiet when the removed package is truly absent", () => {
    expect(
      findRemovalDependencyConflicts({
        removals: ["ghost"],
        requests: [{ name: "luci" }],
        entries: [resolvedEntry("luci"), resolvedEntry("libc")],
        lookup,
      }),
    ).toEqual([]);
  });
});
