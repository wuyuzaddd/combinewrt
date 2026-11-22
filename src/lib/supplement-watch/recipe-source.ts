import type { SourceRegistry, SourceRegistryEntry } from "../sources/types";
import { sha256Hex } from "../source-watch/observe";
import type { SupplementRecipe, SupplementRecipePackage } from "./recipe";

/**
 * Packages the supplement feed ships today. The fallback keeps the watch alive
 * when `config/sources/registry.json` is absent (ticket 12 owns that document),
 * and it matches the build repo's `scripts/select-packages.mjs` allow-list.
 *
 * The iStore stack is rebuilt from istoreos/istore by the extension layer AND
 * kept here: the supplement repository line is what existing devices use, so a
 * name must never disappear from it (2026-11-22: shrinking this list to two
 * packages emptied four packages from /supplement/.../packages.adb).
 */
export const DEFAULT_SUPPLEMENT_PACKAGES = [
  "luci-app-fwlive",
  "luci-app-store",
  "luci-app-substore",
  "luci-lib-taskd",
  "luci-lib-xterm",
  "taskd",
] as const;

export interface SupplementRecipeOptions {
  registry: SourceRegistry;
  sourceRepo: string;
  ref: string;
  baseVersion: string;
  target: string;
}

function targetsEntry(entry: SourceRegistryEntry, target: string): boolean {
  return !entry.targets || entry.targets.includes(target);
}

/**
 * Derive the supplement recipe from the registered `supplement` layer.
 *
 * Only registered recipes are synced (ticket 11 note): an entry whose target
 * list excludes the requested target is not part of this feed, and with no
 * registered supplement entries at all we fall back to the built-in list.
 */
export function buildSupplementRecipe(options: SupplementRecipeOptions): SupplementRecipe {
  const registered = options.registry
    .list()
    .filter((entry) => entry.source === "supplement" && targetsEntry(entry, options.target))
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));

  const packages: SupplementRecipePackage[] =
    registered.length > 0
      ? registered.map((entry) => ({
          name: entry.name,
          license: entry.license ?? null,
          publicAllowed: entry.publicAllowed ?? true,
          recipe: entry.recipe ?? null,
          patches: entry.patches ?? [],
        }))
      : [...DEFAULT_SUPPLEMENT_PACKAGES].map((name) => ({
          name,
          license: null,
          publicAllowed: true,
          recipe: null,
          patches: [],
        }));

  return {
    sourceRepo: options.sourceRepo,
    ref: options.ref,
    baseVersion: options.baseVersion,
    target: options.target,
    packages,
  };
}

/** Short, log-safe identifier for a recipe, used in dispatch payloads. */
export function recipeLabel(recipe: SupplementRecipe): string {
  return sha256Hex(Buffer.from(recipe.packages.map((pkg) => pkg.name).join(","), "utf8")).slice(0, 12);
}
