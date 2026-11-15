import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { PackageSource } from "../catalog/types";
import type { BuildConflict } from "../build/types";

/**
 * Curated common package registry (ticket 08, ADR 0003).
 *
 * This is reviewed metadata, not a feed: the UI (ticket 15) renders it and
 * sends plain package names, the planner resolves them through the catalog and
 * the source registry. `targets`/`kernelLines` are optional restrictions —
 * absent means "applies everywhere". Themes are deliberately not curated here:
 * they arrive through the extension registry (ticket 12).
 */

export const COMMON_PRESET_MIN_PACKAGES = 60;

const PACKAGE_NAME = /^[A-Za-z0-9][A-Za-z0-9+._-]*$/;
const TARGET_ID = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;
const LICENSE = /^[A-Za-z0-9][A-Za-z0-9.+-]*$/;

const packageSchema = z
  .object({
    name: z.string().trim().regex(PACKAGE_NAME, "package name is invalid"),
    /** Chinese, one sentence: shown in the common-package picker. */
    description: z.string().trim().min(1),
    license: z.string().trim().regex(LICENSE, "license must be an SPDX identifier"),
    source: z.enum(["official", "dllkids", "supplement", "extension"]),
    targets: z.array(z.string().trim().regex(TARGET_ID, "target id is invalid")).min(1).optional(),
    kernelLines: z.array(z.enum(["6.6", "6.12", "6.18"])).min(1).optional(),
    /** Curated package names that cannot be selected together with this one. */
    conflicts: z.array(z.string().trim().regex(PACKAGE_NAME, "package name is invalid")).min(1).optional(),
  })
  .strict();

const groupSchema = z
  .object({
    id: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,31}$/, "group id is invalid"),
    title: z.string().trim().min(1),
    description: z.string().trim().min(1).optional(),
    packages: z.array(packageSchema).min(1),
  })
  .strict();

export const commonPresetSchema = z
  .object({
    schemaVersion: z.literal(1),
    groups: z.array(groupSchema).min(1),
  })
  .strict();

export type CommonPackage = z.infer<typeof packageSchema>;
export type CommonGroup = z.infer<typeof groupSchema>;
export type CommonPreset = z.infer<typeof commonPresetSchema>;

export class CommonPresetError extends Error {}

export function commonPresetFilePath(): string {
  return join(process.cwd(), "config/presets/common-v2.json");
}

/** Structural parse only: completeness rules live in `validateCommonPreset`. */
export function parseCommonPreset(raw: unknown): CommonPreset {
  return commonPresetSchema.parse(raw);
}

const CHINESE = /[\u4e00-\u9fff]/;

/**
 * Full completeness check: structural fields first, then the review rules the
 * ticket makes non-negotiable (>=60 packages, no themes, licenses, Chinese
 * descriptions, unique names/groups).
 */
export function validateCommonPreset(raw: unknown): string[] {
  const parsed = commonPresetSchema.safeParse(raw);
  if (!parsed.success) {
    return parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "common-v2"}: ${issue.message}`,
    );
  }

  const issues: string[] = [];
  const preset = parsed.data;
  const total = preset.groups.reduce((sum, group) => sum + group.packages.length, 0);
  if (total < COMMON_PRESET_MIN_PACKAGES) {
    issues.push(
      `common-v2 must curate at least ${COMMON_PRESET_MIN_PACKAGES} packages (found ${total}).`,
    );
  }

  const groupIds = new Set<string>();
  const owners = new Map<string, string>();
  for (const group of preset.groups) {
    if (groupIds.has(group.id)) issues.push(`duplicate group id "${group.id}".`);
    groupIds.add(group.id);
    if (group.id === "theme" || group.id === "themes") {
      issues.push(
        `group "${group.id}" is not allowed: themes ship through the extension registry (ticket 12).`,
      );
    }
    if (!CHINESE.test(group.title)) {
      issues.push(`group "${group.id}": title must be written in Chinese.`);
    }
    for (const pkg of group.packages) {
      if (owners.has(pkg.name)) {
        issues.push(`duplicate package "${pkg.name}" in groups "${owners.get(pkg.name)}" and "${group.id}".`);
      } else {
        owners.set(pkg.name, group.id);
      }
      if (pkg.name.startsWith("luci-theme-")) {
        issues.push(
          `package "${pkg.name}": themes are not common packages; they ship through the extension registry (ticket 12).`,
        );
      }
      if (!CHINESE.test(pkg.description)) {
        issues.push(`package "${pkg.name}": description must be written in Chinese.`);
      }
      if (/proprietary|unknown/i.test(pkg.license)) {
        issues.push(`package "${pkg.name}": license "${pkg.license}" is not a reviewed license.`);
      }
    }
  }

  return issues;
}

let cached: CommonPreset | undefined;

export function loadCommonPreset(): CommonPreset {
  if (cached) return cached;
  const filePath = commonPresetFilePath();
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new CommonPresetError(
      `cannot read ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const issues = validateCommonPreset(raw);
  if (issues.length > 0) {
    throw new CommonPresetError(`${filePath}:\n${issues.join("\n")}`);
  }
  cached = parseCommonPreset(raw);
  return cached;
}

export interface CommonSelectionInput {
  targetId: string;
  kernelLine: string;
  packages: readonly string[];
  /** Catalog sources of the resolved entries, keyed by package name. */
  resolvedSources?: ReadonlyMap<string, string>;
}

/**
 * Plan-time applicability/conflict check for curated packages (ticket 08).
 * A curated package that is not part of the selection is ignored; one that is
 * selected but out of range, conflicting or from another source is named with
 * its source so the 409 is actionable.
 */
export function commonPackageSelectionConflicts(
  preset: CommonPreset,
  input: CommonSelectionInput,
): BuildConflict[] {
  const curated = new Map<string, CommonPackage>();
  for (const group of preset.groups) {
    for (const pkg of group.packages) curated.set(pkg.name, pkg);
  }

  const selected = new Set(input.packages);
  const conflicts: BuildConflict[] = [];
  const seen = new Set<string>();

  const push = (names: string[], message: string) => {
    const key = names.join("|");
    if (seen.has(key)) return;
    seen.add(key);
    conflicts.push({ names, message });
  };

  for (const name of input.packages) {
    const pkg = curated.get(name);
    if (!pkg) continue;

    if (pkg.targets && !pkg.targets.includes(input.targetId)) {
      push(
        [name],
        `Common package "${name}"（来源 ${pkg.source}）仅适用于 target ${pkg.targets.join(", ")}，当前构建目标为 ${input.targetId}。`,
      );
    }
    if (pkg.kernelLines && !(pkg.kernelLines as readonly string[]).includes(input.kernelLine)) {
      push(
        [name],
        `Common package "${name}"（来源 ${pkg.source}）仅适用于内核 ${pkg.kernelLines.join(", ")}，当前内核版本为 ${input.kernelLine}。`,
      );
    }
    for (const other of pkg.conflicts ?? []) {
      if (!selected.has(other)) continue;
      const partner = curated.get(other);
      push(
        [name, other].sort(),
        `Common packages "${name}"（${pkg.source}）与 "${other}"（${partner?.source ?? "unknown"}）不能同时选择。`,
      );
    }
    const resolved = input.resolvedSources?.get(name);
    if (resolved && resolved !== pkg.source && pkg.source !== "extension") {
      push(
        [name],
        `Common package "${name}" 的策展来源是 ${pkg.source}，但包目录中解析为 ${resolved}。`,
      );
    }
  }

  return conflicts;
}

export type { PackageSource };
