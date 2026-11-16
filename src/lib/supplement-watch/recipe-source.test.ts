import { describe, expect, it } from "vitest";
import { createSourceRegistry, EMPTY_SOURCE_REGISTRY } from "../sources/registry";
import type { SourceRegistryEntry } from "../sources/types";
import { fingerprintRecipe } from "./recipe";
import { buildSupplementRecipe, DEFAULT_SUPPLEMENT_PACKAGES, recipeLabel } from "./recipe-source";

const base = {
  sourceRepo: "kiddin9/op-packages",
  ref: "main",
  baseVersion: "25.12.2",
  target: "x86_64",
};

function entry(overrides: Partial<SourceRegistryEntry> & { name: string }): SourceRegistryEntry {
  return {
    source: "supplement",
    strategy: "rebuild",
    ...overrides,
  } as SourceRegistryEntry;
}

describe("buildSupplementRecipe", () => {
  it("falls back to the built-in package list when the registry is empty", () => {
    const recipe = buildSupplementRecipe({ ...base, registry: EMPTY_SOURCE_REGISTRY });
    expect(recipe.packages.map((pkg) => pkg.name)).toEqual([...DEFAULT_SUPPLEMENT_PACKAGES]);
    expect(recipe.packages.every((pkg) => pkg.license === null && pkg.publicAllowed)).toBe(true);
  });

  it("uses only registered supplement entries, sorted by name", () => {
    const registry = createSourceRegistry([
      entry({ name: "taskd", license: "GPL-2.0-only", publicAllowed: true, recipe: "package/taskd" }),
      entry({ name: "luci-app-store", license: "GPL-2.0-only", publicAllowed: false, patches: ["a.patch"] }),
      entry({ name: "not-supplement", source: "dllkids" }),
    ]);
    const recipe = buildSupplementRecipe({ ...base, registry });
    expect(recipe.packages).toEqual([
      { name: "luci-app-store", license: "GPL-2.0-only", publicAllowed: false, recipe: null, patches: ["a.patch"] },
      { name: "taskd", license: "GPL-2.0-only", publicAllowed: true, recipe: "package/taskd", patches: [] },
    ]);
  });

  it("drops entries that are not registered for this target", () => {
    const registry = createSourceRegistry([
      entry({ name: "x86-only", targets: ["x86_64"] }),
      entry({ name: "arm-only", targets: ["aarch64_generic"] }),
    ]);
    const recipe = buildSupplementRecipe({ ...base, registry });
    expect(recipe.packages.map((pkg) => pkg.name)).toEqual(["x86-only"]);
  });

  it("changes the recipe hash when only a patch list changes", () => {
    const without = buildSupplementRecipe({ ...base, registry: createSourceRegistry([entry({ name: "taskd" })]) });
    const withPatch = buildSupplementRecipe({
      ...base,
      registry: createSourceRegistry([entry({ name: "taskd", patches: ["fix-abi.patch"] })]),
    });
    expect(fingerprintRecipe(without).recipeHash).not.toBe(fingerprintRecipe(withPatch).recipeHash);
  });

  it("labels a recipe deterministically from its package names", () => {
    const recipe = buildSupplementRecipe({ ...base, registry: EMPTY_SOURCE_REGISTRY });
    expect(recipeLabel(recipe)).toHaveLength(12);
    expect(recipeLabel(recipe)).toBe(recipeLabel({ ...recipe, packages: [...recipe.packages] }));
  });
});
