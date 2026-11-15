import { isEssentialPackage } from "./essentials";
import { parsePackageRef } from "./refs";
import type { BuildConflict, PackageLookup, RequestedPackage, ResolvedEntry } from "./types";

/** A package supplied by a selected mode, and the mode that owns it. */
export interface ModePackageRef {
  name: string;
  mode: string;
}

export interface PackageRemovalRequest {
  requested: readonly RequestedPackage[];
  removals: readonly string[];
  modePackages?: readonly ModePackageRef[];
}

export interface PackageRemovalResult {
  requests: RequestedPackage[];
  removed: string[];
  warnings: string[];
  conflicts: BuildConflict[];
}

/**
 * Apply the negative package list before dependency resolution (ticket 08).
 *
 * Three outcomes, deliberately distinct: an essential package is a conflict
 * (409, named), a package owned by a mode is a conflict (409, names the mode
 * too), and a package that is simply not selected is a warning — removing an
 * absent package must never look like it did something.
 */
export function applyPackageRemovals(input: PackageRemovalRequest): PackageRemovalResult {
  const conflicts: BuildConflict[] = [];
  const warnings: string[] = [];
  const removed: string[] = [];
  const requestedNames = new Set(input.requested.map((item) => item.name));
  const modeByPackage = new Map((input.modePackages ?? []).map((item) => [item.name, item.mode]));
  const seen = new Set<string>();

  for (const raw of input.removals) {
    const reference = parsePackageRef(raw);
    if (!reference) {
      conflicts.push({ names: [raw], message: `包名格式无效：${raw}` });
      continue;
    }
    const name = reference.name;
    if (seen.has(name)) continue;
    seen.add(name);

    if (isEssentialPackage(name)) {
      conflicts.push({
        names: [name],
        message: `基础包不可移除：${name} 属于启动所必需的 essentials 集合。`,
      });
      continue;
    }

    const mode = modeByPackage.get(name);
    if (mode) {
      conflicts.push({
        names: [name, mode].sort(),
        message: `包 ${name} 由模组 ${mode} 提供，不能单独移除；请先取消该模组。`,
      });
      continue;
    }

    if (!requestedNames.has(name)) {
      warnings.push(`移除的包 ${name} 不在本次构建的包列表中，已忽略。`);
      continue;
    }
    removed.push(name);
  }

  const removedSet = new Set(removed);
  return {
    requests: input.requested.filter((item) => !removedSet.has(item.name)),
    removed,
    warnings,
    conflicts,
  };
}

export interface RemovalDependencyRequest {
  removals: readonly string[];
  requests: readonly RequestedPackage[];
  entries: readonly ResolvedEntry[];
  lookup: PackageLookup;
}

/**
 * A removal only wins over the selection if nothing selected/depended still
 * needs the package. The conflict names both packages and the removed
 * package's source so the UI can point at the right feed.
 */
export function findRemovalDependencyConflicts(input: RemovalDependencyRequest): BuildConflict[] {
  const conflicts: BuildConflict[] = [];
  const removalNames = [...new Set(input.removals.map((raw) => parsePackageRef(raw)?.name).filter(Boolean))] as string[];

  for (const name of removalNames) {
    const source = input.lookup(name)?.source ?? input.entries.find((entry) => entry.name === name)?.packageSource;
    for (const entry of input.entries) {
      if (entry.name === name) continue;
      if (!(input.lookup(entry.name)?.depends ?? []).includes(name)) continue;
      conflicts.push({
        names: [name, entry.name].sort(),
        message: `包 ${name}（来源：${source ?? "official"}）已被移除，但所选包 ${entry.name} 仍依赖它。`,
      });
    }
  }

  return conflicts;
}
