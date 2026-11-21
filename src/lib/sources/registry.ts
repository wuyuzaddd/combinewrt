import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PACKAGE_SOURCES, type PackageSource } from "../catalog/types";
import { isSpdxId } from "./spdx";
import {
  I18N_STATUSES,
  type AcquisitionStrategy,
  type I18nMetadata,
  type I18nStatus,
  type ParsedSourceRegistry,
  type SourceRegistry,
  type SourceRegistryEntry,
  type SourceRegistryViolation,
} from "./types";

/**
 * Source registry loader and validator.
 *
 * Ticket 12 owns the checked-in `config/sources/registry.json`. A missing file
 * must not break V1 catalog planning: it yields an empty registry and the
 * composer keeps the V1 pins as `prebuilt`. A malformed file, on the other
 * hand, throws, because a broken registry must not silently downgrade the
 * public-image guarantees.
 */

export const DEFAULT_SOURCE_REGISTRY_PATH = "config/sources/registry.json";

export function sourceRegistryFilePath(override?: string): string {
  return resolve(process.cwd(), override ?? DEFAULT_SOURCE_REGISTRY_PATH);
}

const NAME_PATTERN = /^[a-z0-9][a-z0-9+._-]*$/;
const REPO_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const STRATEGIES: readonly AcquisitionStrategy[] = ["prebuilt", "rebuild", "blocked"];
const URL_PATTERN = /https?:\/\//i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recipeFor(repo: string, ref: string, subdir: string): string {
  return `github:${repo}@${ref}/${subdir}`;
}

/**
 * Prefix of a recipe that lives in the build repository itself
 * (`.github/packages/<name>`) instead of an upstream checkout. It exists for
 * upstreams that publish prebuilt archives without an OpenWrt package
 * definition (quickstart): the recipe is ours, the pinned `repo`/`ref` still
 * name the upstream the published manifest points at.
 */
export const LOCAL_RECIPE_PREFIX = "local:";

export function localRecipeFor(name: string): string {
  return `${LOCAL_RECIPE_PREFIX}${name}`;
}

/**
 * Validate the nested `i18n` object. The status is required and restricted to
 * the ADR 0003 values; title/description are optional display text. This is
 * metadata only and deliberately independent of every admission check.
 */
function parseI18nMetadata(raw: unknown, fail: (message: string) => void): I18nMetadata | undefined {
  if (raw === undefined) {
    fail("i18n is required and must declare a status");
    return undefined;
  }
  if (!isPlainObject(raw)) {
    fail("i18n must be an object with a status");
    return undefined;
  }
  const status = raw.status;
  if (typeof status !== "string" || !(I18N_STATUSES as readonly string[]).includes(status)) {
    fail(`i18n.status must be one of ${I18N_STATUSES.join(", ")}`);
    return undefined;
  }
  const title = raw.title;
  if (title !== undefined && (typeof title !== "string" || !title.trim())) {
    fail("i18n.title must be a non-empty string when present");
  }
  const description = raw.description;
  if (description !== undefined && (typeof description !== "string" || !description.trim())) {
    fail("i18n.description must be a non-empty string when present");
  }
  return {
    status: status as I18nStatus,
    ...(typeof title === "string" && title.trim() ? { title: title.trim() } : {}),
    ...(typeof description === "string" && description.trim() ? { description: description.trim() } : {}),
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Normalise `""` to `.` and reject absolute or escaping package subdirectories. */
export function normalizeExtensionSubdir(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "." || trimmed === "./") return ".";
  if (trimmed.startsWith("/")) return null;
  const segments = trimmed.replace(/^\.\//, "").split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return null;
  return segments.join("/");
}

/**
 * Validate one entry and collect every problem instead of stopping at the
 * first one. This is the single implementation shared by the runtime loader,
 * the `sources:validate` script and the extension build workflow.
 */
function validateEntry(
  raw: unknown,
  path: string,
  seen: Set<string>,
  violations: SourceRegistryViolation[],
): SourceRegistryEntry | null {
  const fail = (message: string) => violations.push({ path, message });
  if (!isPlainObject(raw)) {
    fail("entry must be an object");
    return null;
  }

  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) fail("name is required");
  else if (!NAME_PATTERN.test(name)) fail(`name "${name}" is not a valid package name`);

  const source = raw.source;
  if (typeof source !== "string" || !(PACKAGE_SOURCES as readonly string[]).includes(source)) {
    fail(`source must be one of ${PACKAGE_SOURCES.join(", ")}`);
    return null;
  }
  const key = `${name}@${source}`;
  if (name && seen.has(key)) fail(`duplicate registry entry for ${name} in layer ${source}`);
  seen.add(key);

  const strategy = raw.strategy;
  if (typeof strategy !== "string" || !(STRATEGIES as readonly string[]).includes(strategy)) {
    fail(`strategy must be one of ${STRATEGIES.join(", ")}`);
  }

  if (!isSpdxId(raw.license)) {
    fail(
      typeof raw.license === "string"
        ? `license "${raw.license}" is not a reviewed SPDX identifier`
        : "license is required (SPDX identifier)",
    );
  }

  if (typeof raw.publicAllowed !== "boolean") {
    fail("publicAllowed is required and must be a boolean");
  }

  const pin = typeof raw.pin === "string" && raw.pin.trim() ? raw.pin.trim() : null;
  // Official packages follow the catalog release pins, so a registry record
  // for them may leave the pin empty. Every other layer must name the exact
  // upstream identity it was reviewed against.
  if (source === "official") {
    if (pin && URL_PATTERN.test(pin)) fail("pin must not be a feed URL");
  } else if (!pin) {
    fail("pin is required (immutable upstream identity)");
  } else if (URL_PATTERN.test(pin)) {
    fail("pin must not be a feed URL");
  }

  for (const field of ["targets", "kernelLines", "patches"] as const) {
    const value = raw[field];
    if (value === undefined) continue;
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
      fail(`${field} must be an array of non-empty strings`);
    }
  }
  if (Array.isArray(raw.patches)) {
    for (const patch of raw.patches) {
      if (typeof patch !== "string") continue;
      if (patch.startsWith("/") || patch.split("/").includes("..")) {
        fail(`patch path "${patch}" must be a safe relative path`);
      }
    }
  }
  if (Array.isArray(raw.targets) && raw.targets.length === 0) fail("targets must not be empty when present");
  if (Array.isArray(raw.kernelLines) && raw.kernelLines.length === 0) fail("kernelLines must not be empty when present");

  for (const field of ["recipe", "abi", "repo", "ref", "subdir", "recipeHash"] as const) {
    const value = raw[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string" || URL_PATTERN.test(value)) {
      fail(`${field} must be a string and must not contain a feed URL`);
    }
  }

  if (raw.i18nStatus !== undefined) {
    fail("i18nStatus is not supported at the top level; move it under i18n.status");
  }
  const i18n = parseI18nMetadata(raw.i18n, fail);

  if (raw.experimental !== undefined && typeof raw.experimental !== "boolean") {
    fail("experimental must be a boolean when present");
  }

  const targets = Array.isArray(raw.targets) ? (raw.targets as string[]).map((item) => item.trim()) : undefined;
  const kernelLines = Array.isArray(raw.kernelLines)
    ? (raw.kernelLines as string[]).map((item) => item.trim())
    : undefined;
  const patches = Array.isArray(raw.patches) ? (raw.patches as string[]).map((item) => item.trim()) : undefined;

  const entry: SourceRegistryEntry = {
    name,
    source: source as PackageSource,
    pin,
    license: typeof raw.license === "string" ? raw.license : null,
    publicAllowed: typeof raw.publicAllowed === "boolean" ? raw.publicAllowed : false,
    ...(targets ? { targets } : {}),
    ...(kernelLines ? { kernelLines } : {}),
    strategy: strategy as AcquisitionStrategy,
    ...(typeof raw.recipe === "string" ? { recipe: raw.recipe } : {}),
    ...(typeof raw.abi === "string" ? { abi: raw.abi } : {}),
    ...(patches ? { patches } : {}),
    ...(i18n ? { i18n, i18nStatus: i18n.status } : {}),
    ...(typeof raw.experimental === "boolean" ? { experimental: raw.experimental } : {}),
  };

  if (source === "extension") {
    const repo = typeof raw.repo === "string" ? raw.repo.trim() : "";
    const ref = typeof raw.ref === "string" ? raw.ref.trim() : "";
    const subdirValue = typeof raw.subdir === "string" ? raw.subdir : name;
    const subdir = normalizeExtensionSubdir(subdirValue);

    if (!REPO_PATTERN.test(repo)) fail("extension repo is required as owner/name");
    if (!COMMIT_PATTERN.test(ref)) fail("extension ref must be a lowercase 40-hex commit");
    if (subdir === null) fail(`extension subdir "${subdirValue}" is not a safe relative path`);
    if (pin && ref && pin !== ref) fail(`extension pin must equal the pinned ref (${pin} != ${ref})`);
    if (strategy === "prebuilt") fail("extension packages must use the rebuild strategy");
    if (!targets || targets.length === 0) fail("extension packages must declare the targets they support");
    if (patches && patches.length > 0) fail("extension packages do not support source patches yet");
    if (repo && ref && subdir) {
      const declaredRecipe = typeof raw.recipe === "string" ? raw.recipe.trim() : "";
      const local = declaredRecipe.startsWith(LOCAL_RECIPE_PREFIX);
      // A local recipe is named after the package because the build workflow
      // maps `local:<name>` to `.github/packages/<name>` with no extra field.
      const expectedRecipe = local ? localRecipeFor(name) : recipeFor(repo, ref, subdir);
      if (declaredRecipe !== expectedRecipe) {
        fail(
          local
            ? `extension local recipe must be "${expectedRecipe}"`
            : `extension recipe must be "${expectedRecipe}"`,
        );
      }
      if (typeof raw.recipeHash !== "string" || !SHA256_PATTERN.test(raw.recipeHash)) {
        fail("extension recipeHash must be the sha256 of the recipe");
      } else if (raw.recipeHash !== sha256(expectedRecipe)) {
        fail(`extension recipeHash does not match sha256(${expectedRecipe})`);
      }
      entry.repo = repo;
      entry.ref = ref;
      entry.subdir = subdir;
      entry.recipe = expectedRecipe;
      entry.recipeHash = typeof raw.recipeHash === "string" ? raw.recipeHash : null;
      if (!entry.pin) entry.pin = ref;
    }
  } else if ((source === "dllkids" || source === "supplement") && !pin) {
    fail(`${source} packages need a pinned index/commit`);
  }

  return entry;
}

/**
 * Validate a whole registry document (`{ schemaVersion, packages }` or a bare
 * array) and return the entries that passed plus every violation found.
 */
export function validateSourceRegistryDocument(raw: unknown): ParsedSourceRegistry {
  const violations: SourceRegistryViolation[] = [];
  const entries: SourceRegistryEntry[] = [];
  const seen = new Set<string>();

  let packages: unknown;
  if (Array.isArray(raw)) {
    packages = raw;
  } else if (isPlainObject(raw)) {
    if (raw.schemaVersion !== undefined && raw.schemaVersion !== 1) {
      violations.push({ path: "schemaVersion", message: "schemaVersion must be 1" });
    }
    packages = raw.packages;
  } else {
    violations.push({ path: "<root>", message: "registry document must be an object or an array" });
  }

  if (!Array.isArray(packages)) {
    if (!violations.some((item) => item.path === "<root>")) {
      violations.push({ path: "packages", message: "packages must be an array" });
    }
    return { entries, violations };
  }

  packages.forEach((item, index) => {
    const entry = validateEntry(item, `packages.${index}`, seen, violations);
    if (entry) entries.push(entry);
  });

  return { entries, violations };
}

/** Wrap a plain list of records in the read interface used by the planner. */
export function createSourceRegistry(entries: readonly SourceRegistryEntry[]): SourceRegistry {
  const list = entries.map((entry) => ({ ...entry }));
  return {
    list: () => list,
    lookup(name, query = {}) {
      const matches = list.filter((entry) => entry.name === name);
      if (query.source) {
        return matches.find((entry) => entry.source === query.source) ?? null;
      }
      return matches[0] ?? null;
    },
  };
}

export const EMPTY_SOURCE_REGISTRY: SourceRegistry = { lookup: () => null, list: () => [] };

/** Parse a registry document; every schema violation is reported at once. */
export function parseSourceRegistry(raw: unknown): SourceRegistry {
  const { entries, violations } = validateSourceRegistryDocument(raw);
  if (violations.length > 0) {
    throw new Error(
      `Invalid source registry:\n- ${violations.map((item) => `${item.path}: ${item.message}`).join("\n- ")}`,
    );
  }
  return createSourceRegistry(entries);
}

const registryCache = new Map<string, SourceRegistry>();

export interface LoadSourceRegistryOptions {
  /** Override the registry file path; used by tests and alternate checkouts. */
  filePath?: string;
}

/**
 * Load the source registry, caching the parsed document per file path.
 *
 * Missing file: empty registry (V1 catalog pins stay authoritative).
 * Unreadable or malformed file: throw, because a broken registry must not
 * silently downgrade public-image guarantees.
 */
export function loadSourceRegistry(options: LoadSourceRegistryOptions = {}): SourceRegistry {
  const filePath = sourceRegistryFilePath(options.filePath);
  const cached = registryCache.get(filePath);
  if (cached) return cached;

  let rawText: string;
  try {
    rawText = readFileSync(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      registryCache.set(filePath, EMPTY_SOURCE_REGISTRY);
      return EMPTY_SOURCE_REGISTRY;
    }
    throw new Error(
      `Cannot read source registry at ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(rawText);
  } catch (error) {
    throw new Error(
      `Source registry at ${filePath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const registry = parseSourceRegistry(raw);
  registryCache.set(filePath, registry);
  return registry;
}
