import type { PackageLookup, ResolvedEntry } from "./types";

// Skips negative dependencies, version constraints, and virtual provides
// (`so:`, `cmd:`, `PACKAGE_x:y`) that the ImageBuilder resolves at build time.
function parseDependency(raw: string): string[] {
  return raw
    .split("|")
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate.length > 0 && !candidate.startsWith("!"))
    .map((candidate) => candidate.replace(/^\+/, ""))
    .map((candidate) => candidate.replace(/[<>=~].*$/, "").trim())
    .filter((candidate) => candidate.length > 0 && !candidate.includes(":"));
}

export function resolveDependencies(
  requested: string[],
  lookup: PackageLookup,
): { entries: ResolvedEntry[]; missingDependencies: string[] } {
  const entries: ResolvedEntry[] = [];
  const seen = new Set<string>();
  const missing = new Set<string>();
  const queue: Array<{ name: string; source: "selected" | "dependency" }> = [];

  for (const name of requested) {
    if (seen.has(name)) continue;
    seen.add(name);
    queue.push({ name, source: "selected" });
  }

  while (queue.length > 0) {
    const { name, source } = queue.shift()!;
    const hit = lookup(name);
    entries.push({ name, version: hit?.version ?? null, source });
    if (!hit) continue;

    for (const raw of hit.depends) {
      const candidates = parseDependency(raw);
      const available = candidates.find((candidate) => lookup(candidate) !== null);
      const chosen = available ?? candidates[0];
      if (!chosen) continue;
      if (seen.has(chosen)) continue;
      if (!available) {
        missing.add(chosen);
        continue;
      }
      seen.add(chosen);
      queue.push({ name: chosen, source: "dependency" });
    }
  }

  return { entries, missingDependencies: [...missing].sort() };
}
