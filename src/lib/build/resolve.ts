import type { PackageLookup, PackageLookupAll, RequestedPackage, ResolvedEntry } from "./types";

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

function toResolved(
  name: string,
  source: "selected" | "dependency",
  hit: ReturnType<PackageLookup>,
): ResolvedEntry {
  return {
    name,
    version: hit?.version ?? null,
    source,
    packageSource: hit?.source ?? null,
    sourcePin: hit?.sourcePin ?? null,
    sha256: hit?.sha256 ?? null,
    feed: hit?.feed ?? null,
    license: hit?.license ?? null,
    proprietary: hit?.proprietary ?? false,
  };
}

export function resolveDependencies(
  requested: Array<string | RequestedPackage>,
  lookup: PackageLookup,
  lookupAll?: PackageLookupAll,
): { entries: ResolvedEntry[]; missingDependencies: string[] } {
  const entries: ResolvedEntry[] = [];
  const seen = new Set<string>();
  const missing = new Set<string>();
  const preferred = (name: string) => lookup(name) ?? lookupAll?.(name)?.[0] ?? null;
  const forced = new Map<string, ReturnType<PackageLookup>>();
  const queue: Array<{ name: string; source: "selected" | "dependency" }> = [];

  for (const item of requested) {
    const request = typeof item === "string" ? { name: item } : item;
    if (request.source) {
      const candidates = lookupAll?.(request.name) ?? [];
      const hit = candidates.find((candidate) => candidate.source === request.source) ?? null;
      forced.set(request.name, hit);
    }
    if (seen.has(request.name)) continue;
    seen.add(request.name);
    queue.push({ name: request.name, source: "selected" });
  }

  while (queue.length > 0) {
    const { name, source } = queue.shift()!;
    const hit = forced.get(name) ?? preferred(name);
    entries.push(toResolved(name, source, hit));
    if (!hit) continue;

    for (const raw of hit.depends) {
      const candidates = parseDependency(raw);
      const available = candidates.find((candidate) => (forced.get(candidate) ?? preferred(candidate)) !== null);
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
