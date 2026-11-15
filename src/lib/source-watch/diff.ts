import { compareVersions } from "../catalog/packages";
import type { PackageDiff, PackageFingerprint } from "./types";

/**
 * Compare two full package fingerprints. `sameVersionHashChanges` is the
 * adoption guardrail: the same package version must keep the same artifact
 * hash, otherwise the upstream rebuilt (or tampered with) an existing version.
 */
export function diffPackages(
  active: PackageFingerprint[],
  candidate: PackageFingerprint[],
): PackageDiff {
  const activeByName = new Map(active.map((pkg) => [pkg.name, pkg]));
  const candidateByName = new Map(candidate.map((pkg) => [pkg.name, pkg]));

  const added: string[] = [];
  const removed: string[] = [];
  const upgraded: PackageDiff["upgraded"] = [];
  const downgraded: PackageDiff["downgraded"] = [];
  const sameVersionHashChanges: PackageDiff["sameVersionHashChanges"] = [];

  for (const [name, candidatePkg] of candidateByName) {
    const activePkg = activeByName.get(name);
    if (!activePkg) {
      added.push(name);
      continue;
    }
    const order = compareVersions(candidatePkg.version, activePkg.version);
    if (order > 0) {
      upgraded.push({ name, from: activePkg.version, to: candidatePkg.version });
    } else if (order < 0) {
      downgraded.push({ name, from: activePkg.version, to: candidatePkg.version });
    } else if (
      activePkg.sha256 &&
      candidatePkg.sha256 &&
      activePkg.sha256 !== candidatePkg.sha256
    ) {
      sameVersionHashChanges.push({
        name,
        version: candidatePkg.version,
        from: activePkg.sha256,
        to: candidatePkg.sha256,
      });
    }
  }

  for (const name of activeByName.keys()) {
    if (!candidateByName.has(name)) removed.push(name);
  }

  const byName = (left: string, right: string) => left.localeCompare(right);
  added.sort(byName);
  removed.sort(byName);
  upgraded.sort((left, right) => left.name.localeCompare(right.name));
  downgraded.sort((left, right) => left.name.localeCompare(right.name));
  sameVersionHashChanges.sort((left, right) => left.name.localeCompare(right.name));

  return {
    activeCount: active.length,
    candidateCount: candidate.length,
    added,
    removed,
    upgraded,
    downgraded,
    sameVersionHashChanges,
  };
}

export function describePackageDiff(diff: PackageDiff): string[] {
  const lines = [
    `包数 ${diff.activeCount} → ${diff.candidateCount}`,
    `新增 ${diff.added.length} · 删除 ${diff.removed.length} · 升级 ${diff.upgraded.length} · 降级 ${diff.downgraded.length}`,
  ];
  for (const change of diff.sameVersionHashChanges.slice(0, 10)) {
    lines.push(`同版本哈希变化：${change.name} ${change.version}`);
  }
  if (diff.sameVersionHashChanges.length > 10) {
    lines.push(`同版本哈希变化：另有 ${diff.sameVersionHashChanges.length - 10} 个`);
  }
  return lines;
}

export function isPackageDiff(value: unknown): value is PackageDiff {
  if (!value || typeof value !== "object") return false;
  const diff = value as Partial<PackageDiff>;
  return (
    typeof diff.activeCount === "number" &&
    typeof diff.candidateCount === "number" &&
    Array.isArray(diff.added) &&
    Array.isArray(diff.removed) &&
    Array.isArray(diff.upgraded) &&
    Array.isArray(diff.downgraded) &&
    Array.isArray(diff.sameVersionHashChanges)
  );
}
