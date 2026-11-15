import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CapabilityRegistry } from "../src/lib/catalog/capabilities";
import { capabilitiesFilePath, validateCapabilities } from "../src/lib/catalog/capabilities";

/**
 * Validate the checked-in capability registry.
 *
 * Usage: tsx scripts/validate-capabilities.ts [path-to-registry.json]
 *
 * Exits non-zero and lists every violation when the registry is invalid, so CI
 * fails with actionable output instead of stopping at the first problem.
 */
function main(): number {
  const arg = process.argv[2];
  const filePath = arg ? resolve(process.cwd(), arg) : capabilitiesFilePath();

  let rawText: string;
  try {
    rawText = readFileSync(filePath, "utf8");
  } catch (error) {
    console.error(`capabilities: cannot read ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(rawText);
  } catch (error) {
    console.error(`capabilities: ${filePath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  const violations = validateCapabilities(raw);
  if (violations.length > 0) {
    console.error(`capabilities: ${violations.length} violation(s) in ${filePath}`);
    for (const violation of violations) {
      console.error(`  - ${violation}`);
    }
    return 1;
  }

  const registry = raw as CapabilityRegistry;
  const profiles = registry.targets.reduce((total, target) => total + target.profiles.length, 0);
  const variants = registry.targets.reduce(
    (total, target) => total + target.profiles.reduce((count, profile) => count + profile.variants.length, 0),
    0,
  );
  console.log(
    `capabilities: OK — ${registry.targets.length} target(s), ${profiles} profile(s), ${variants} variant declaration(s), ` +
      `${registry.kernelLines.length} kernel line(s), ${registry.modes.length} mode(s) from ${filePath}`,
  );
  return 0;
}

process.exit(main());
