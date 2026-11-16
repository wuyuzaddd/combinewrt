import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { extensionBundlesFilePath, validateExtensionBundles } from "../src/lib/extension/bundles";
import { extensionThemesFilePath, validateExtensionThemes } from "../src/lib/extension/themes";
import { createSourceRegistry, sourceRegistryFilePath, validateSourceRegistryDocument } from "../src/lib/sources/registry";

/**
 * Validate the checked-in unified source registry, extension themes and
 * one-click bundles (ticket 12).
 *
 * Usage: tsx scripts/validate-sources.ts [--registry path] [--themes path] [--bundles path]
 *
 * Exits non-zero and lists every violation, so CI fails with actionable output
 * instead of stopping at the first problem.
 */

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function readJson(path: string, label: string): unknown | null {
  let rawText: string;
  try {
    rawText = readFileSync(path, "utf8");
  } catch (error) {
    console.error(`${label}: cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  try {
    return JSON.parse(rawText);
  } catch (error) {
    console.error(`${label}: ${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function main(): number {
  const registryPath = option("registry") ?? process.env.SOURCE_REGISTRY_PATH ?? sourceRegistryFilePath();
  const themesPath = option("themes") ?? extensionThemesFilePath();
  const bundlesPath = option("bundles") ?? extensionBundlesFilePath();

  const rawRegistry = readJson(resolve(process.cwd(), registryPath), "sources");
  if (rawRegistry === null) return 1;
  const { entries, violations: registryViolations } = validateSourceRegistryDocument(rawRegistry);
  if (registryViolations.length > 0) {
    console.error(`sources: ${registryViolations.length} violation(s) in ${registryPath}`);
    for (const violation of registryViolations) {
      console.error(`  - ${violation.path}: ${violation.message}`);
    }
    return 1;
  }
  const registry = createSourceRegistry(entries);

  let failed = false;

  const rawThemes = readJson(resolve(process.cwd(), themesPath), "themes");
  if (rawThemes === null) return 1;
  const { themes, violations: themeViolations } = validateExtensionThemes(rawThemes, registry);
  if (themeViolations.length > 0) {
    failed = true;
    console.error(`themes: ${themeViolations.length} violation(s) in ${themesPath}`);
    for (const violation of themeViolations) {
      console.error(`  - ${violation.path}: ${violation.message}`);
    }
  }

  const rawBundles = readJson(resolve(process.cwd(), bundlesPath), "bundles");
  if (rawBundles === null) return 1;
  const { bundles, violations: bundleViolations } = validateExtensionBundles(rawBundles, registry);
  if (bundleViolations.length > 0) {
    failed = true;
    console.error(`bundles: ${bundleViolations.length} violation(s) in ${bundlesPath}`);
    for (const violation of bundleViolations) {
      console.error(`  - ${violation.path}: ${violation.message}`);
    }
  }

  if (failed) return 1;

  const layers = ["official", "dllkids", "supplement", "extension"].map((layer) => {
    const count = entries.filter((entry) => entry.source === layer).length;
    return `${layer} ${count}`;
  });
  const proxy = bundles.filter((bundle) => bundle.category === "proxy").length;
  const storage = bundles.filter((bundle) => ["nas", "download", "monitor"].includes(bundle.category)).length;
  console.log(
    `sources: OK — ${entries.length} packages (${layers.join(", ")}), ${bundles.length} bundles (proxy ${proxy}, nas/download/monitor ${storage}), ${themes.length} themes`,
  );
  return 0;
}

process.exit(main());
