import { describe, expect, it } from "vitest";
import {
  decidePublishGate,
  fingerprintRecipe,
  type SupplementRecipe,
} from "./recipe";

function recipe(overrides: Partial<SupplementRecipe> = {}): SupplementRecipe {
  return {
    sourceRepo: "kiddin9/op-packages",
    ref: "main",
    baseVersion: "25.12.2",
    target: "x86_64",
    packages: [
      { name: "luci-app-store", license: "Apache-2.0", publicAllowed: true },
      { name: "taskd", license: "GPL-2.0-only", publicAllowed: true },
    ],
    ...overrides,
  };
}

describe("fingerprintRecipe", () => {
  it("is order independent and stable", () => {
    const forward = fingerprintRecipe(recipe());
    const reversed = fingerprintRecipe(
      recipe({ packages: [...recipe().packages].reverse() }),
    );
    expect(reversed).toEqual(forward);
    expect(forward.recipeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(forward.spdx).toBe("Apache-2.0,GPL-2.0-only");
    expect(forward.packageSetShape).toEqual(["luci-app-store", "taskd"]);
    expect(forward.publicAllowed).toBe(true);
  });

  it("treats a missing license as NOASSERTION", () => {
    const fingerprint = fingerprintRecipe(
      recipe({ packages: [{ name: "taskd", license: null, publicAllowed: true }] }),
    );
    expect(fingerprint.spdx).toBe("NOASSERTION");
  });

  it("is public only when every package is allowed", () => {
    const fingerprint = fingerprintRecipe(
      recipe({
        packages: [
          { name: "luci-app-store", license: "Apache-2.0", publicAllowed: true },
          { name: "taskd", license: "GPL-2.0-only", publicAllowed: false },
        ],
      }),
    );
    expect(fingerprint.publicAllowed).toBe(false);
  });

  it("changes the recipe hash when the upstream ref changes", () => {
    expect(fingerprintRecipe(recipe({ ref: "openwrt-24.10" })).recipeHash).not.toBe(
      fingerprintRecipe(recipe()).recipeHash,
    );
  });
});

describe("decidePublishGate", () => {
  const candidate = fingerprintRecipe(recipe());

  it("stages the first publish because there is no baseline", () => {
    expect(decidePublishGate({ active: null, candidate })).toEqual({
      publishMode: "staging",
      reason: "first_publish",
      changed: ["first_publish"],
    });
  });

  it("auto-publishes when all four gate fields are unchanged", () => {
    expect(decidePublishGate({ active: candidate, candidate })).toEqual({
      publishMode: "live",
      reason: "metadata_unchanged",
      changed: [],
    });
  });

  it("stages a license change and reports every difference", () => {
    const changed = fingerprintRecipe(
      recipe({
        packages: [
          { name: "luci-app-store", license: "MIT", publicAllowed: true },
          { name: "taskd", license: "GPL-2.0-only", publicAllowed: true },
        ],
      }),
    );
    const decision = decidePublishGate({ active: candidate, candidate: changed });
    expect(decision.publishMode).toBe("staging");
    expect(decision.reason).toBe("recipe_changed");
    expect(decision.changed).toEqual(["recipe_changed", "spdx_changed"]);
  });

  it("stages a publicAllowed change", () => {
    const changed = fingerprintRecipe(
      recipe({
        packages: [
          { name: "luci-app-store", license: "Apache-2.0", publicAllowed: true },
          { name: "taskd", license: "GPL-2.0-only", publicAllowed: false },
        ],
      }),
    );
    const decision = decidePublishGate({ active: candidate, candidate: changed });
    expect(decision.reason).toBe("recipe_changed");
    expect(decision.changed).toContain("public_allowed_changed");
  });

  it("stages a package-set shape change", () => {
    const changed = fingerprintRecipe(
      recipe({
        packages: [{ name: "taskd", license: "GPL-2.0-only", publicAllowed: true }],
      }),
    );
    const decision = decidePublishGate({ active: candidate, candidate: changed });
    expect(decision.publishMode).toBe("staging");
    expect(decision.changed).toContain("package_set_changed");
  });
});
