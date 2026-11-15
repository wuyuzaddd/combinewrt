import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import type { SourceRegistry, SourceRegistryEntry } from "./types";

/**
 * Source registry loader.
 *
 * Ticket 12 owns the checked-in `config/sources/registry.json`. Until it lands,
 * the file is absent, which must not break V1 catalog planning: a missing file
 * yields an empty registry and the composer keeps the V1 pins as `prebuilt`.
 * A partial file is fine too — entries that are not registered just fall back
 * to the same V1 behaviour.
 */

export const DEFAULT_SOURCE_REGISTRY_PATH = "config/sources/registry.json";

export function sourceRegistryFilePath(override?: string): string {
  return resolve(process.cwd(), override ?? DEFAULT_SOURCE_REGISTRY_PATH);
}

const strategySchema = z.enum(["prebuilt", "rebuild", "blocked"]);

const entrySchema = z.object({
  name: z.string().trim().min(1),
  source: z.enum(["official", "dllkids", "supplement", "extension"]),
  pin: z.string().nullable().optional(),
  license: z.string().nullable().optional(),
  publicAllowed: z.boolean().optional(),
  targets: z.array(z.string().trim().min(1)).optional(),
  kernelLines: z.array(z.string().trim().min(1)).optional(),
  strategy: strategySchema,
  recipe: z.string().nullable().optional(),
  abi: z.string().nullable().optional(),
  patches: z.array(z.string()).optional(),
});

const documentSchema = z.object({
  schemaVersion: z.literal(1).optional(),
  packages: z.array(entrySchema),
});

/** Wrap a plain list of records in the read interface used by the planner. */
export function createSourceRegistry(entries: readonly SourceRegistryEntry[]): SourceRegistry {
  const list = entries.map((entry) => ({ ...entry }));
  return {
    lookup(name, query = {}) {
      const matches = list.filter((entry) => entry.name === name);
      if (query.source) {
        return matches.find((entry) => entry.source === query.source) ?? null;
      }
      return matches[0] ?? null;
    },
  };
}

export const EMPTY_SOURCE_REGISTRY: SourceRegistry = { lookup: () => null };

/** Parse a registry document; every schema violation is reported at once. */
export function parseSourceRegistry(raw: unknown): SourceRegistry {
  const parsed = documentSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`,
    );
    throw new Error(`Invalid source registry:\n- ${issues.join("\n- ")}`);
  }
  return createSourceRegistry(parsed.data.packages);
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
