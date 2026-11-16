import { sha256Hex } from "../source-watch/observe";

/**
 * A supplement recipe is the local declaration of *what* the supplement feed
 * ships: which packages are rebuilt from the upstream source tree, under which
 * licenses and whether they may be served publicly.
 *
 * ADR 0008 makes this recipe the publish gate: a new base-version index may go
 * live automatically only while the recipe hash, the SPDX identifiers, the
 * publicAllowed verdict and the package-set shape are all unchanged. Anything
 * else is staged for a human.
 */
export interface SupplementRecipePackage {
  name: string;
  /** SPDX identifier, or null when the license is not declared. */
  license: string | null;
  publicAllowed: boolean;
  /** Source recipe path used by the build repo; null when not declared. */
  recipe?: string | null;
  /** Patch files applied before building, in order. */
  patches?: readonly string[];
}

export interface SupplementRecipe {
  /** Upstream repository the packages are built from, e.g. kiddin9/op-packages. */
  sourceRepo: string;
  /** Branch that source commits are observed on. */
  ref: string;
  /** ImmortalWrt base version the supplement feed belongs to. */
  baseVersion: string;
  /** Feed target directory, e.g. x86_64. */
  target: string;
  packages: SupplementRecipePackage[];
}

export interface RecipeFingerprint {
  /** sha256 over the recipe shape (source repo, ref, package metadata). */
  recipeHash: string;
  /** Sorted, unique SPDX identifiers joined with commas. */
  spdx: string;
  /** True only when every package in the recipe is allowed to be public. */
  publicAllowed: boolean;
  /** Sorted package names; the *shape* of the package set, not its versions. */
  packageSetShape: string[];
  /** sha256 over the four gate fields; the stored comparison key. */
  fingerprint: string;
}

export const NO_ASSERTION_LICENSE = "NOASSERTION";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return Object.fromEntries(entries.map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonical(value));
}

export function fingerprintRecipe(recipe: SupplementRecipe): RecipeFingerprint {
  const packages = [...recipe.packages]
    .map((pkg) => ({
      name: pkg.name,
      license: pkg.license ?? NO_ASSERTION_LICENSE,
      publicAllowed: pkg.publicAllowed,
      // Build inputs are part of the recipe: swapping a recipe file or a patch
      // changes what the feed ships even when names and licenses stay put.
      recipe: pkg.recipe ?? null,
      patches: [...(pkg.patches ?? [])],
    }))
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));

  const recipeHash = sha256Hex(
    Buffer.from(
      canonicalJson({ sourceRepo: recipe.sourceRepo, ref: recipe.ref, packages }),
      "utf8",
    ),
  );

  const spdx = [...new Set(packages.map((pkg) => pkg.license))].sort().join(",");
  const publicAllowed = packages.every((pkg) => pkg.publicAllowed);
  const packageSetShape = packages.map((pkg) => pkg.name);

  const fingerprint = sha256Hex(
    Buffer.from(
      canonicalJson({ recipeHash, spdx, publicAllowed, packageSetShape }),
      "utf8",
    ),
  );

  return { recipeHash, spdx, publicAllowed, packageSetShape, fingerprint };
}

export type PublishGateReason =
  | "first_publish"
  | "metadata_unchanged"
  | "recipe_changed"
  | "spdx_changed"
  | "public_allowed_changed"
  | "package_set_changed";

export type PublishMode = "live" | "staging";

export interface PublishGateDecision {
  publishMode: PublishMode;
  reason: PublishGateReason;
  /** Gate fields that differ from the active pin, in comparison order. */
  changed: PublishGateReason[];
}

const COMPARISONS: Array<{
  reason: Exclude<PublishGateReason, "first_publish" | "metadata_unchanged">;
  differs: (active: RecipeFingerprint, candidate: RecipeFingerprint) => boolean;
}> = [
  { reason: "recipe_changed", differs: (a, b) => a.recipeHash !== b.recipeHash },
  { reason: "spdx_changed", differs: (a, b) => a.spdx !== b.spdx },
  { reason: "public_allowed_changed", differs: (a, b) => a.publicAllowed !== b.publicAllowed },
  {
    reason: "package_set_changed",
    differs: (a, b) => a.packageSetShape.join("\u0000") !== b.packageSetShape.join("\u0000"),
  },
];

/**
 * Decide whether a candidate may auto-publish to the live feed.
 *
 * Only a candidate whose four gate fields are byte-identical to the active pin
 * is published live; with no baseline at all nothing is trusted yet, so the
 * first publish is always staged.
 */
export function decidePublishGate(input: {
  active: RecipeFingerprint | null;
  candidate: RecipeFingerprint;
}): PublishGateDecision {
  if (!input.active) {
    return { publishMode: "staging", reason: "first_publish", changed: ["first_publish"] };
  }

  const changed = COMPARISONS.filter((comparison) =>
    comparison.differs(input.active as RecipeFingerprint, input.candidate),
  ).map((comparison) => comparison.reason);

  if (changed.length === 0) {
    return { publishMode: "live", reason: "metadata_unchanged", changed: [] };
  }

  return { publishMode: "staging", reason: changed[0], changed };
}
