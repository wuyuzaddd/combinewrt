import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

/**
 * Packages the site refuses to plan for.
 *
 * The catalogue is generated from feeds, so a package can be listed upstream
 * yet be uninstallable next to the rest of the image (e.g. luci-app-mosdns
 * depends on official mosdns and both own /etc/init.d/mosdns). Keeping the
 * list in config lets the picker hide it and the planner explain why, without
 * a code change per broken package.
 */
export const DEFAULT_BLOCKED_PACKAGES_PATH = "config/catalog/blocked.json";

const blockedSchema = z.object({
  schemaVersion: z.literal(1).optional(),
  packages: z
    .array(
      z.object({
        name: z.string().trim().min(1),
        reason: z.string().trim().min(1),
      }),
    )
    .default([]),
});

export interface BlockedPackage {
  name: string;
  reason: string;
}

export function blockedPackagesFilePath(override?: string): string {
  return resolve(process.cwd(), override ?? DEFAULT_BLOCKED_PACKAGES_PATH);
}

export function loadBlockedPackages(path?: string): Map<string, string> {
  const parsed = blockedSchema.parse(JSON.parse(readFileSync(blockedPackagesFilePath(path), "utf8")));
  return new Map(parsed.packages.map((entry) => [entry.name, entry.reason]));
}
