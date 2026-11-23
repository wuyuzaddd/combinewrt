import type { SourceRegistry } from "../sources/types";
import { parseDependency } from "./resolve";
import type { BuildConflict, PackageLookup, ResolvedEntry } from "./types";
import type { VirtualProviderLookup } from "./virtual-providers";

/**
 * Catalogue-level dependency-closure check (ticket 12 hardening).
 *
 * The workflow preflight is the authority for a concrete image: it runs
 * `apk add --simulate` against the final repository set before `make image`.
 * This planner-side check is deliberately narrower: it only raises a 409 when
 * the active catalog snapshot can decide that a package depends on a known
 * source-registry package that the snapshot does not contain. Dependencies the
 * snapshot cannot decide (unknown names, or a plan that includes a registry-only
 * extension entry) stay warnings, never a false 409.
 */
export interface DependencyClosureInput {
  entries: readonly ResolvedEntry[];
  lookup: PackageLookup;
  sources: SourceRegistry;
  /** Alias table for names apk resolves through `Provides` (see virtual-providers). */
  virtuals?: VirtualProviderLookup;
}

export interface DependencyClosureResult {
  conflicts: BuildConflict[];
  warnings: string[];
}

const SNAPSHOT_SOURCES = new Set(["official", "dllkids", "supplement"]);

export function checkDependencyClosure(input: DependencyClosureInput): DependencyClosureResult {
  const conflicts: BuildConflict[] = [];
  const warnings: string[] = [];
  const selected = new Set(input.entries.map((entry) => entry.name));
  const seen = new Set<string>();
  // `extension` entries live only in the source registry: the snapshot cannot
  // enumerate their dependency graph, so a plan containing one keeps unknowns
  // as warnings.
  const snapshotCanDecide = input.entries.every(
    (entry) => entry.packageSource !== null && entry.packageSource !== "extension",
  );

  for (const entry of input.entries) {
    const hit = input.lookup(entry.name);
    if (!hit) continue;
    const source = entry.packageSource ?? "unknown";
    for (const raw of hit.depends) {
      const candidates = parseDependency(raw);
      if (candidates.length === 0) continue;
      if (candidates.some((candidate) => selected.has(candidate))) continue;
      // `resolveDependencies` already pulls every dependency it can find. A
      // candidate that still resolves is therefore outside the plan on purpose
      // (a removal); the removal conflict owns that decision.
      if (candidates.some((candidate) => input.lookup(candidate) !== null)) continue;
      // A virtual name is satisfied by one of its declared providers: either the
      // provider is already in the plan, or the snapshot carries it and the
      // image preflight will pull it in.
      const virtualProvider = candidates
        .flatMap((candidate) => input.virtuals?.(candidate) ?? [])
        .find((provider) => selected.has(provider) || input.lookup(provider) !== null);
      if (virtualProvider) continue;

      for (const candidate of candidates) {
        const record = input.sources.lookup(candidate);
        if (record && snapshotCanDecide && SNAPSHOT_SOURCES.has(record.source)) {
          const key = `conflict:${entry.name}:${candidate}`;
          if (seen.has(key)) continue;
          seen.add(key);
          conflicts.push({
            names: [entry.name, candidate],
            message:
              `Package "${entry.name}" (${source}) depends on "${candidate}" (${record.source}), ` +
              `which the active catalog snapshot does not contain. The workflow preflight remains ` +
              `authoritative for the concrete image, so fix the catalogue or pick another package.`,
          });
          continue;
        }
        const key = `warning:${entry.name}:${candidate}`;
        if (seen.has(key)) continue;
        seen.add(key);
        warnings.push(
          `Package "${entry.name}" (${source}) depends on "${candidate}", which the catalog snapshot ` +
            `cannot verify; the workflow preflight remains authoritative for the concrete image.`,
        );
      }
    }
  }

  return { conflicts, warnings };
}
