import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CapabilityRegistry } from "../src/lib/catalog/capabilities";
import { capabilitiesFilePath, validateCapabilities } from "../src/lib/catalog/capabilities";
import { loadModeDeclarations, validateModeDeclarations } from "../src/lib/build/modes";

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

  // Mode declarations and the capability registry must agree on id, layer and
  // experimental flag; a mode gated to an engine must declare that requirement.
  let declarations;
  try {
    declarations = loadModeDeclarations();
  } catch (error) {
    console.error(`modes: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  const modeViolations = validateModeDeclarations(declarations, registry.modes);
  if (modeViolations.length > 0) {
    console.error(`modes: ${modeViolations.length} violation(s) against ${filePath}`);
    for (const violation of modeViolations) {
      console.error(`  - ${violation}`);
    }
    return 1;
  }

  const profiles = registry.targets.reduce((total, target) => total + target.profiles.length, 0);
  const variants = registry.targets.reduce(
    (total, target) => total + target.profiles.reduce((count, profile) => count + profile.variants.length, 0),
    0,
  );
  console.log(
    `capabilities: OK — ${registry.targets.length} target(s), ${profiles} profile(s), ${variants} variant declaration(s), ` +
      `${registry.kernelLines.length} kernel line(s), ${registry.modes.length} mode(s), ` +
      `${declarations.length} mode declaration(s) from ${filePath}`,
  );
  return 0;
}

process.exit(main());
