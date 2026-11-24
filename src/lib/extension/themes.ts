import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import type { SourceRegistry } from "../sources/types";
import type { ExtensionTheme, ExtensionViolation } from "./types";

/**
 * Extension theme registry (`config/extension/themes.json`, ticket 12).
 *
 * Themes are ordinary extension packages with presentation metadata. They
 * enter a plan through the normal package/bundle path; there is no second
 * installer and a theme is never a mode.
 */

export const DEFAULT_EXTENSION_THEMES_PATH = "config/extension/themes.json";

export function extensionThemesFilePath(override?: string): string {
  return resolve(process.cwd(), override ?? DEFAULT_EXTENSION_THEMES_PATH);
}

const previewSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => value.startsWith("/"), "preview must be a site-relative path starting with /")
  .refine((value) => /\.(svg|png|webp|jpg)$/i.test(value), "preview must be an image path");

const themeSchema = z.object({
  package: z.string().trim().min(1),
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  preview: previewSchema,
  luciVersions: z.array(z.string().trim().min(1)).min(1),
  default: z.boolean(),
  experimental: z.boolean().optional(),
});

const documentSchema = z.object({
  schemaVersion: z.literal(1).optional(),
  themes: z.array(themeSchema),
});

export interface ParsedExtensionThemes {
  themes: ExtensionTheme[];
  violations: ExtensionViolation[];
}

/**
 * Validate theme metadata against the schema and against the source registry:
 * every theme must be a registered extension package, exactly one theme may be
 * the default, and the LuCI versions must be concrete release lines.
 */
export function validateExtensionThemes(raw: unknown, registry: SourceRegistry): ParsedExtensionThemes {
  const violations: ExtensionViolation[] = [];
  const parsed = documentSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      violations.push({ path: `themes.${issue.path.join(".")}`, message: issue.message });
    }
    return { themes: [], violations };
  }

  const themes: ExtensionTheme[] = [];
  const seen = new Set<string>();
  let defaults = 0;
  parsed.data.themes.forEach((theme, index) => {
    const path = `themes.${index}`;
    if (seen.has(theme.package)) {
      violations.push({ path, message: `duplicate theme package ${theme.package}` });
    }
    seen.add(theme.package);

    // A theme may be curated in the extension registry or ship in the official
    // feeds; both are installable, so accept either and only reject names that
    // resolve nowhere. (luci-theme-argon moved to official in ImmortalWrt
    // 25.12.2, so requiring the extension source rejected a valid theme.)
    const record =
      registry.lookup(theme.package, { source: "extension" }) ??
      registry.lookup(theme.package, { source: "official" });
    if (!record) {
      violations.push({ path, message: `${theme.package} is not a registered extension or official package` });
    } else {
      if (record.publicAllowed !== true) {
        violations.push({ path, message: `${theme.package} is not publicAllowed, so it cannot be a public theme` });
      }
      const experimental = record.experimental === true;
      if (theme.experimental !== undefined && theme.experimental !== experimental) {
        violations.push({
          path,
          message: `experimental must match the registry entry (${String(experimental)})`,
        });
      }
    }

    for (const version of theme.luciVersions) {
      if (!/^\d+\.\d+$/.test(version)) {
        violations.push({ path, message: `LuCI version "${version}" must look like 24.10` });
      }
    }
    if (theme.default) defaults += 1;
    themes.push({
      package: theme.package,
      title: theme.title,
      description: theme.description,
      preview: theme.preview,
      luciVersions: theme.luciVersions,
      default: theme.default,
      ...(theme.experimental !== undefined ? { experimental: theme.experimental } : {}),
    });
  });

  if (themes.length > 0 && defaults !== 1) {
    violations.push({ path: "themes", message: `exactly one theme must be the default (found ${defaults})` });
  }

  return { themes, violations };
}

/** Parse and validate themes; throws when the document is malformed. */
export function parseExtensionThemes(raw: unknown, registry: SourceRegistry): ExtensionTheme[] {
  const { themes, violations } = validateExtensionThemes(raw, registry);
  if (violations.length > 0) {
    throw new Error(
      `Invalid extension themes:\n- ${violations.map((item) => `${item.path}: ${item.message}`).join("\n- ")}`,
    );
  }
  return themes;
}

let themesCache: ExtensionTheme[] | null = null;

/** Load `config/extension/themes.json`, validating it against the registry. */
export function loadExtensionThemes(options: { filePath?: string; registry: SourceRegistry }): ExtensionTheme[] {
  if (!options.filePath && themesCache) return themesCache;
  const filePath = extensionThemesFilePath(options.filePath);
  let rawText: string;
  try {
    rawText = readFileSync(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      if (!options.filePath) themesCache = [];
      return [];
    }
    throw new Error(`Cannot read extension themes at ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const themes = parseExtensionThemes(JSON.parse(rawText), options.registry);
  if (!options.filePath) themesCache = themes;
  return themes;
}

/** True when the theme declares support for the given LuCI release line. */
export function themeSupportsLuCI(theme: ExtensionTheme, luciVersion: string): boolean {
  return theme.luciVersions.includes(luciVersion);
}

/** The default theme, if the document declares one. */
export function defaultTheme(themes: readonly ExtensionTheme[]): ExtensionTheme | null {
  return themes.find((theme) => theme.default) ?? null;
}
