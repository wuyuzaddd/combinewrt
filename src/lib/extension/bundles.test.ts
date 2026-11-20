import { describe, expect, it } from "vitest";
import { createSourceRegistry, loadSourceRegistry } from "../sources/registry";
import { loadExtensionBundles } from "./bundles";
import type { SourceRegistryEntry } from "../sources/types";
import {
  BUNDLE_COVERAGE,
  expandBundleTokens,
  parseExtensionBundles,
  validateExtensionBundles,
} from "./bundles";

const entries: SourceRegistryEntry[] = [
  { name: "luci-app-openclash", source: "extension", pin: "a".repeat(40), ref: "a".repeat(40), license: "MIT", publicAllowed: true, targets: ["x86/64"], strategy: "rebuild", recipe: `github:x/y@${"a".repeat(40)}/.` },
  { name: "kmod-tun", source: "official", pin: "releases/25.12.2", license: "GPL-2.0-only", publicAllowed: true, targets: ["x86/64"], strategy: "prebuilt" },
  { name: "luci-app-generic", source: "official", pin: "releases/25.12.2", license: "MIT", publicAllowed: true, strategy: "prebuilt" },
  { name: "luci-app-dockerman", source: "extension", pin: "b".repeat(40), ref: "b".repeat(40), license: "AGPL-3.0-only", publicAllowed: false, targets: ["x86/64"], strategy: "rebuild", recipe: `github:x/y@${"b".repeat(40)}/.` },
];
const registry = createSourceRegistry(entries);

function bundle(overrides: Record<string, unknown> = {}) {
  return {
    id: "proxy-openclash",
    title: "OpenClash 代理",
    description: "开箱可用的代理面板。",
    category: "proxy",
    packages: ["luci-app-openclash"],
    targets: ["x86/64"],
    license: "MIT",
    publicAllowed: true,
    tests: ["dependency"],
    ...overrides,
  };
}

describe("extension bundles", () => {
  it("accepts a bundle that only references registry packages", () => {
    const bundles = parseExtensionBundles({ bundles: [bundle()] }, registry, { enforceCoverage: false });
    expect(bundles[0]?.packages).toEqual(["luci-app-openclash"]);
    expect(bundles[0]?.tests).toEqual(["dependency"]);
  });

  it("rejects unknown packages, unknown SPDX ids, scripts and hooks", () => {
    const unknownPackage = validateExtensionBundles(
      { bundles: [bundle({ packages: ["ghost"] })] },
      registry,
      { enforceCoverage: false },
    );
    expect(unknownPackage.violations.map((item) => item.message).join("\n")).toMatch(/not in the source registry/);

    const badLicense = validateExtensionBundles(
      { bundles: [bundle({ license: "BEERWARE" })] },
      registry,
      { enforceCoverage: false },
    );
    expect(badLicense.violations.length).toBeGreaterThan(0);

    const scripted = validateExtensionBundles(
      { bundles: [bundle({ scripts: ["postinst"] })] },
      registry,
      { enforceCoverage: false },
    );
    expect(scripted.violations.length).toBeGreaterThan(0);
  });

  it("refuses a public bundle that includes a non-public package", () => {
    const { violations } = validateExtensionBundles(
      { bundles: [bundle({ packages: ["luci-app-dockerman"], license: "AGPL-3.0-only" })] },
      registry,
      { enforceCoverage: false },
    );
    expect(violations.map((item) => item.message).join("\n")).toMatch(/not publicAllowed/);
  });

  it("requires the dependency test declaration", () => {
    const { violations } = validateExtensionBundles(
      { bundles: [bundle({ tests: ["installability"] })] },
      registry,
      { enforceCoverage: false },
    );
    expect(violations.map((item) => item.message).join("\n")).toMatch(/must include dependency/);
  });

  it("enforces the curated coverage minimums", () => {
    const { violations } = validateExtensionBundles({ bundles: [bundle()] }, registry);
    const text = violations.map((item) => item.message).join("\n");
    expect(text).toMatch(new RegExp(`at least ${BUNDLE_COVERAGE.total} bundles`));
    expect(text).toMatch(new RegExp(`at least ${BUNDLE_COVERAGE.proxy} proxy bundles`));
    expect(text).toMatch(new RegExp(`at least ${BUNDLE_COVERAGE.nasDownloadMonitor} NAS/download/monitor bundles`));
  });

  it("expands every curated bundle from the checked-in catalogue into its package list", () => {
    const realRegistry = loadSourceRegistry();
    const realBundles = loadExtensionBundles({ registry: realRegistry });

    expect(realBundles.length).toBeGreaterThanOrEqual(10);
    for (const real of realBundles) {
      const expanded = expandBundleTokens([`bundle:${real.id}`], {
        bundles: realBundles,
        registry: realRegistry,
        targetId: "x86/64",
      });
      expect(expanded.conflicts, real.id).toEqual([]);
      expect(expanded.bundles, real.id).toEqual([real.id]);
      expect(new Set(expanded.packages), real.id).toEqual(new Set(real.packages));
    }
  });

  it("expands bundle tokens into plain package requests", () => {
    const bundles = parseExtensionBundles({ bundles: [bundle()] }, registry, { enforceCoverage: false });
    const expanded = expandBundleTokens(["bundle:proxy-openclash", "kmod-tun"], {
      bundles,
      registry,
      targetId: "x86/64",
    });
    expect(expanded.packages).toEqual(["luci-app-openclash", "kmod-tun"]);
    expect(expanded.bundles).toEqual(["proxy-openclash"]);
    expect(expanded.conflicts).toEqual([]);
  });

  it("keeps an id that is also a registry package name as a package request", () => {
    const bundles = parseExtensionBundles(
      { bundles: [bundle({ id: "kmod-tun", packages: ["luci-app-openclash"] })] },
      registry,
      { enforceCoverage: false },
    );
    const expanded = expandBundleTokens(["kmod-tun"], { bundles, registry, targetId: "x86/64" });
    expect(expanded.packages).toEqual(["kmod-tun"]);
    expect(expanded.bundles).toEqual([]);
  });

  it("reports unknown bundles and target mismatches as conflicts", () => {
    const bundles = parseExtensionBundles(
      { bundles: [bundle({ packages: ["luci-app-generic"], license: "MIT", targets: ["aarch64/generic"] })] },
      registry,
      { enforceCoverage: false },
    );
    const unknown = expandBundleTokens(["bundle:nope"], { bundles, registry, targetId: "x86/64" });
    expect(unknown.conflicts[0]?.message).toMatch(/未知套餐/);

    const mismatch = expandBundleTokens(["bundle:proxy-openclash"], { bundles, registry, targetId: "x86/64" });
    expect(mismatch.conflicts[0]?.message).toMatch(/不支持目标/);
    expect(mismatch.packages).toEqual([]);
  });
});
