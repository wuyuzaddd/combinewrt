/**
 * Client-safe target/profile search (ticket 15). No node imports, so the build
 * form can filter capability options in the browser.
 */
import type { TargetFilter, TargetOption } from "./ui-types";

export function filterTargets(targets: readonly TargetOption[], filter: TargetFilter): TargetOption[] {
  const query = (filter.query ?? "").trim().toLowerCase();
  const capability = (filter.capability ?? "").trim();
  return targets.flatMap((target) => {
    if (capability && !target.profiles.some((profile) => profile.capabilities.includes(capability))) {
      return [];
    }
    const targetMatches =
      !query ||
      [target.id, target.title, target.architecture, target.subtarget].join(" ").toLowerCase().includes(query);
    const profiles = target.profiles.filter((profile) => {
      if (capability && !profile.capabilities.includes(capability)) return false;
      if (!query || targetMatches) return true;
      return [profile.id, profile.title, ...profile.capabilities].join(" ").toLowerCase().includes(query);
    });
    return profiles.length > 0 ? [{ ...target, profiles }] : [];
  });
}
