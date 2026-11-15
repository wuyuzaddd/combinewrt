import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSourceRegistry, parseSourceRegistry, validateSourceRegistryDocument } from "./registry";

const ref = "a121960d2adbe9d57333db3f4e045467dcb375c9";
const repo = "jerrykuku/luci-theme-argon";
const recipe = `github:${repo}@${ref}/.`;
const recipeHash = createHash("sha256").update(recipe).digest("hex");

function extensionEntry(overrides: Record<string, unknown> = {}) {
  return {
    name: "luci-theme-argon",
    source: "extension",
    pin: ref,
    license: "Apache-2.0",
    publicAllowed: true,
    targets: ["x86/64"],
    strategy: "rebuild",
    repo,
    ref,
    subdir: ".",
    recipe,
    recipeHash,
    i18nStatus: "curated",
    ...overrides,
  };
}

describe("source registry extension validation", () => {
  it("accepts a fully pinned extension entry and keeps its i18n metadata", () => {
    const registry = parseSourceRegistry({ schemaVersion: 1, packages: [extensionEntry()] });
    expect(registry.lookup("luci-theme-argon", { source: "extension" })).toMatchObject({
      name: "luci-theme-argon",
      source: "extension",
      pin: ref,
      ref,
      repo,
      subdir: ".",
      recipe,
      recipeHash,
      i18nStatus: "curated",
      publicAllowed: true,
    });
  });

  it("rejects an unreviewed SPDX identifier", () => {
    const { violations } = validateSourceRegistryDocument({ packages: [extensionEntry({ license: "WTFPL" })] });
    expect(violations.map((item) => item.message).join("\n")).toMatch(/not a reviewed SPDX identifier/);
  });

  it("rejects a missing publicAllowed flag", () => {
    const entry = extensionEntry();
    delete (entry as Record<string, unknown>).publicAllowed;
    const { violations } = validateSourceRegistryDocument({ packages: [entry] });
    expect(violations.map((item) => item.message).join("\n")).toMatch(/publicAllowed is required/);
  });

  it("rejects an unpinned or non-40-hex extension ref", () => {
    for (const bad of [{ ref: "main" }, { pin: null, ref: "HEAD" }]) {
      const entry = extensionEntry(bad);
      const { violations } = validateSourceRegistryDocument({ packages: [entry] });
      expect(violations.length).toBeGreaterThan(0);
    }
  });

  it("rejects a recipe hash that does not match the recipe", () => {
    const { violations } = validateSourceRegistryDocument({
      packages: [extensionEntry({ recipeHash: "0".repeat(64) })],
    });
    expect(violations.map((item) => item.message).join("\n")).toMatch(/recipeHash does not match/);
  });

  it("rejects arbitrary feed URLs anywhere in the document", () => {
    const { violations } = validateSourceRegistryDocument({
      packages: [extensionEntry({ recipe: "https://example.com/feed.tar.gz" })],
    });
    expect(violations.map((item) => item.message).join("\n")).toMatch(/recipe must be/);
  });

  it("rejects duplicate entries in the same layer but allows the same name in two layers", () => {
    const duplicate = validateSourceRegistryDocument({
      packages: [extensionEntry(), extensionEntry()],
    });
    expect(duplicate.violations.map((item) => item.message).join("\n")).toMatch(/duplicate registry entry/);

    const shared = parseSourceRegistry({
      packages: [
        extensionEntry(),
        {
          name: "luci-theme-argon",
          source: "official",
          pin: "releases/25.12.2",
          license: "Apache-2.0",
          publicAllowed: true,
          strategy: "prebuilt",
        },
      ],
    });
    expect(shared.lookup("luci-theme-argon", { source: "extension" })?.source).toBe("extension");
    expect(shared.lookup("luci-theme-argon", { source: "official" })?.source).toBe("official");
  });

  it("keeps the registry read interface working with an empty list", () => {
    const registry = createSourceRegistry([]);
    expect(registry.lookup("anything")).toBeNull();
    expect(registry.list()).toEqual([]);
  });
});
