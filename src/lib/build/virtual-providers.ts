import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Virtual dependency names → the real packages that provide them.
 *
 * apk accepts dependency names that no package carries literally: `ip` is
 * provided by `ip-full`/`ip-tiny`, `iptables` by the nft implementation,
 * `libffmpeg` by `libffmpeg-full`, and so on. The catalog snapshot only indexes
 * package names, so a literal lookup reports these as missing and the plan
 * preview lists them under 目录中缺少依赖 even though the image builds fine.
 *
 * This is data, not code: `config/deps/virtual-providers.json` is editable
 * without touching the planner, and the first candidate that exists in the
 * active snapshot wins.
 */
export interface VirtualProviderMap {
  [dependency: string]: readonly string[];
}

/** Injection seam for tests and callers that already loaded the map. */
export type VirtualProviderLookup = (dependency: string) => readonly string[];

let cached: VirtualProviderMap | null = null;

export function loadVirtualProviders(): VirtualProviderMap {
  if (cached) return cached;
  const path = join(process.cwd(), "config", "deps", "virtual-providers.json");
  const parsed = JSON.parse(readFileSync(path, "utf8")) as { providers?: VirtualProviderMap };
  cached = parsed.providers ?? {};
  return cached;
}

/** Providers declared for a dependency name, in preference order. */
export function virtualProvidersFor(
  dependency: string,
  map: VirtualProviderMap = loadVirtualProviders(),
): readonly string[] {
  return map[dependency] ?? [];
}

/** Ready-made lookup for `resolveDependencies` / `checkDependencyClosure`. */
export const virtualProviderLookup: VirtualProviderLookup = (dependency) =>
  virtualProvidersFor(dependency);
