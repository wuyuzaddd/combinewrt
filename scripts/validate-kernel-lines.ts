import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { KernelLineRegistry } from "../src/lib/build/source";
import { validateKernelLineRegistry } from "../src/lib/build/source";

/**
 * Validate the checked-in kernel-line registry.
 *
 * Usage: tsx scripts/validate-kernel-lines.ts [path-to-registry.json]
 *
 * Exits non-zero and lists every violation when the registry is invalid, so CI
 * fails with actionable output instead of stopping at the first problem.
 */
function main(): number {
  const arg = process.argv[2];
  const filePath = arg ? resolve(process.cwd(), arg) : resolve(process.cwd(), "config/kernel-lines.json");

  let rawText: string;
  try {
    rawText = readFileSync(filePath, "utf8");
  } catch (error) {
    console.error(`kernel-lines: cannot read ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(rawText);
  } catch (error) {
    console.error(`kernel-lines: ${filePath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  const violations = validateKernelLineRegistry(raw);
  if (violations.length > 0) {
    console.error(`kernel-lines: ${violations.length} violation(s) in ${filePath}`);
    for (const violation of violations) {
      console.error(`  - ${violation}`);
    }
    return 1;
  }

  const registry = raw as KernelLineRegistry;
  const source = registry.lines.filter((line) => line.engine === "source");
  const imagebuilder = registry.lines.filter((line) => line.engine === "imagebuilder");
  console.log(
    `kernel-lines: OK — ${registry.lines.length} line(s) (${source.length} source, ${imagebuilder.length} imagebuilder), ` +
      `unwanted: ${registry.unwantedVersions.join(", ")} from ${filePath}`,
  );
  for (const line of registry.lines) {
    if (line.engine === "source") {
      console.log(
        `  ${line.id}: source ${line.source.repo}@${line.source.ref.slice(0, 12)} ` +
          `(${line.source.branch}), expected kernel ${line.source.expectedKernel}, cache key ${line.source.cacheKey}`,
      );
    } else {
      console.log(`  ${line.id}: imagebuilder`);
    }
  }
  return 0;
}

process.exit(main());
