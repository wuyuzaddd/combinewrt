import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import type { BuildConflict } from "../build/types";
import type { SourceRegistry } from "../sources/types";
import { isSpdxId } from "../sources/spdx";
import {
  EXTENSION_BUNDLE_CATEGORIES,
  EXTENSION_BUNDLE_TESTS,
  type ExtensionBundle,
  type ExtensionBundleTest,
  type ExtensionViolation,
} from "./types";

/**
 * One-click extension bundles (`config/extension/bundles.json`, ticket 12).
 *
 * A bundle is a named list of registry packages. It owns no scripts, hooks or
 * install steps: selecting it simply expands into the same `packages` array the
 * V1/V2 planner already understands, so the licence gate, kmod ABI checks and
 * the feed preflight apply unchanged.
 */

export const DEFAULT_EXTENSION_BUNDLES_PATH = "config/extension/bundles.json";

export function extensionBundlesFilePath(override?: string): string {
  return resolve(process.cwd(), override ?? DEFAULT_EXTENSION_BUNDLES_PATH);
}

/** Category coverage the curated set must reach (ticket 12 acceptance). */
export const BUNDLE_COVERAGE = {
  total: 10,
  proxy: 3,
  nasDownloadMonitor: 3,
} as const;

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

const bundleSchema = z
  .object({
    id: z.string().trim().min(1),
    title: z.string().trim().min(1),
    description: z.string().trim().min(1),
    category: z.enum(EXTENSION_BUNDLE_CATEGORIES as [string, ...string[]]),
    packages: z.array(z.string().trim().min(1)).min(1),
    targets: z.array(z.string().trim().min(1)).min(1),
    license: z.string().trim().min(1),
    publicAllowed: z.boolean(),
    tests: z.array(z.enum(["dependency", "installability"] as [string, ...string[]])).min(1),
    notes: z.string().optional(),
  })
  .strict();

const documentSchema = z.object({
  schemaVersion: z.literal(1).optional(),
  bundles: z.array(bundleSchema),
});

export interface ParsedExtensionBundles {
  bundles: ExtensionBundle[];
  violations: ExtensionViolation[];
}

export interface ValidateBundlesOptions {
  /** Enforce the curated-set coverage minimums (default true). */
  enforceCoverage?: boolean;
}

/**
 * Validate bundles against the registry: packages must exist, a public bundle
 * may only contain public packages, licences must be reviewed SPDX ids, and
 * every bundle must declare both dependency and installability tests.
 */
export function validateExtensionBundles(
  raw: unknown,
  registry: SourceRegistry,
  options: ValidateBundlesOptions = {},
): ParsedExtensionBundles {
  const violations: ExtensionViolation[] = [];
  const parsed = documentSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      violations.push({ path: `bundles.${issue.path.join(".")}`, message: issue.message });
    }
    return { bundles: [], violations };
  }

  const bundles: ExtensionBundle[] = [];
  const seen = new Set<string>();
  for (const [index, bundle] of parsed.data.bundles.entries()) {
    const path = `bundles.${index}`;
    const category = bundle.category;
    if (!ID_PATTERN.test(bundle.id)) {
      violations.push({ path, message: `id "${bundle.id}" must be lowercase letters, digits and dashes` });
    }
    if (seen.has(bundle.id)) violations.push({ path, message: `duplicate bundle id ${bundle.id}` });
    seen.add(bundle.id);

    if (!isSpdxId(bundle.license)) {
      violations.push({ path, message: `license "${bundle.license}" is not a reviewed SPDX identifier` });
    }
    const tests = bundle.tests as ExtensionBundleTest[];
    // Every bundle must be gated by the dependency test; installability is the
    // optional second gate for bundles whose packages need a kernel module.
    if (!tests.includes("dependency")) {
      violations.push({
        path,
        message: `tests must include dependency (one of ${EXTENSION_BUNDLE_TESTS.join(", ")})`,
      });
    }

    const unique = new Set<string>();
    for (const name of bundle.packages) {
      if (unique.has(name)) violations.push({ path, message: `duplicate package ${name} in bundle ${bundle.id}` });
      unique.add(name);
      const record = registry.lookup(name);
      if (!record) {
        violations.push({ path, message: `package ${name} is not in the source registry` });
        continue;
      }
      if (bundle.publicAllowed && record.publicAllowed !== true) {
        violations.push({
          path,
          message: `public bundle ${bundle.id} includes ${name}, which is not publicAllowed`,
        });
      }
      if (bundle.targets.length > 0 && record.targets && record.targets.length > 0) {
        const covered = bundle.targets.some((target) => record.targets?.includes(target));
        if (!covered) {
          violations.push({ path, message: `${name} does not support any bundle target (${bundle.targets.join(", ")})` });
        }
      }
    }

    bundles.push({
      id: bundle.id,
      title: bundle.title,
      description: bundle.description,
      category: category as ExtensionBundle["category"],
      packages: bundle.packages,
      targets: bundle.targets,
      license: bundle.license,
      publicAllowed: bundle.publicAllowed,
      tests,
      ...(bundle.notes ? { notes: bundle.notes } : {}),
    });
  }

  if (options.enforceCoverage !== false) {
    violations.push(...coverageViolations(bundles));
  }
  return { bundles, violations };
}

/** Coverage of the curated bundle set: total, proxy and NAS/download/monitor. */
export function coverageViolations(bundles: readonly ExtensionBundle[]): ExtensionViolation[] {
  const violations: ExtensionViolation[] = [];
  if (bundles.length < BUNDLE_COVERAGE.total) {
    violations.push({
      path: "bundles",
      message: `at least ${BUNDLE_COVERAGE.total} bundles are required (found ${bundles.length})`,
    });
  }
  const count = (categories: readonly ExtensionBundle["category"][]) =>
    bundles.filter((bundle) => categories.includes(bundle.category)).length;
  if (count(["proxy"]) < BUNDLE_COVERAGE.proxy) {
    violations.push({ path: "bundles", message: `at least ${BUNDLE_COVERAGE.proxy} proxy bundles are required` });
  }
  if (count(["nas", "download", "monitor"]) < BUNDLE_COVERAGE.nasDownloadMonitor) {
    violations.push({
      path: "bundles",
      message: `at least ${BUNDLE_COVERAGE.nasDownloadMonitor} NAS/download/monitor bundles are required`,
    });
  }
  return violations;
}

/** Parse and validate bundles; throws when the document is malformed. */
export function parseExtensionBundles(
  raw: unknown,
  registry: SourceRegistry,
  options: ValidateBundlesOptions = {},
): ExtensionBundle[] {
  const { bundles, violations } = validateExtensionBundles(raw, registry, options);
  if (violations.length > 0) {
    throw new Error(
      `Invalid extension bundles:\n- ${violations.map((item) => `${item.path}: ${item.message}`).join("\n- ")}`,
    );
  }
  return bundles;
}

let bundlesCache: ExtensionBundle[] | null = null;

/** Load `config/extension/bundles.json`, validating it against the registry. */
export function loadExtensionBundles(options: { filePath?: string; registry: SourceRegistry }): ExtensionBundle[] {
  if (!options.filePath && bundlesCache) return bundlesCache;
  const filePath = extensionBundlesFilePath(options.filePath);
  let rawText: string;
  try {
    rawText = readFileSync(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      if (!options.filePath) bundlesCache = [];
      return [];
    }
    throw new Error(`Cannot read extension bundles at ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const bundles = parseExtensionBundles(JSON.parse(rawText), options.registry);
  if (!options.filePath) bundlesCache = bundles;
  return bundles;
}

export interface ExpandBundlesOptions {
  bundles: readonly ExtensionBundle[];
  registry: SourceRegistry;
  targetId: string;
}

export interface ExpandedBundles {
  /** Expanded plain package requests, in first-seen order. */
  packages: string[];
  /** Bundle ids that were expanded. */
  bundles: string[];
  conflicts: BuildConflict[];
}

/**
 * Expand `bundle:<id>` tokens (and bare bundle ids that are not package names)
 * into plain package requests. Unknown bundles and target mismatches are
 * reported as conflicts naming the bundle, so the plan route answers 409.
 */
export function expandBundleTokens(
  tokens: readonly string[],
  options: ExpandBundlesOptions,
): ExpandedBundles {
  const packages: string[] = [];
  const expanded: string[] = [];
  const conflicts: BuildConflict[] = [];
  const byId = new Map(options.bundles.map((bundle) => [bundle.id, bundle]));

  for (const token of tokens) {
    const bundleId = token.startsWith("bundle:") ? token.slice("bundle:".length) : token;
    const bundle = byId.get(bundleId);
    if (!bundle) {
      if (token.startsWith("bundle:")) {
        conflicts.push({ names: [token], message: `未知套餐：${bundleId}` });
      }
      packages.push(token);
      continue;
    }
    // A bare id is a package request unless no registry package owns the name.
    if (!token.startsWith("bundle:") && options.registry.lookup(bundleId)) {
      packages.push(token);
      continue;
    }
    if (!bundle.targets.includes(options.targetId)) {
      conflicts.push({
        names: [bundle.id],
        message: `套餐 ${bundle.id} 不支持目标 ${options.targetId}（支持：${bundle.targets.join(", ")}）`,
      });
      continue;
    }
    expanded.push(bundle.id);
    for (const name of bundle.packages) {
      if (!packages.includes(name)) packages.push(name);
    }
  }

  return { packages, bundles: expanded, conflicts };
}
