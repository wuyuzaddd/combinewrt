import type { SourceRegistry, SourceRegistryEntry } from "../sources/types";
import { i18nStatusOf } from "./i18n";
import { defaultTheme } from "./themes";
import type { ExtensionBundle, ExtensionTheme } from "./types";

/**
 * Read model of the catalog/extension page (ticket 12): search over extension
 * packages, the curated bundle list, and theme preview metadata.
 */
export interface ExtensionCatalogPackage {
  name: string;
  /** Human title: the theme title when the package is a theme, else the name. */
  title: string;
  description: string;
  license: string | null;
  publicAllowed: boolean;
  i18nStatus: ReturnType<typeof i18nStatusOf>;
  experimental: boolean;
  repo: string | null;
  ref: string | null;
  targets: readonly string[];
  theme: ExtensionTheme | null;
}

export interface ExtensionCatalogCounts {
  packages: number;
  publicPackages: number;
  experimental: number;
  bundles: number;
  themes: number;
}

export interface ExtensionCatalog {
  query: string;
  packages: ExtensionCatalogPackage[];
  bundles: ExtensionBundle[];
  themes: ExtensionTheme[];
  counts: ExtensionCatalogCounts;
}

export interface CreateExtensionCatalogInput {
  registry: SourceRegistry;
  themes: readonly ExtensionTheme[];
  bundles: readonly ExtensionBundle[];
  query?: string;
}

function matchesPackage(
  entry: Pick<SourceRegistryEntry, "name" | "repo" | "license" | "i18nStatus">,
  theme: ExtensionTheme | null,
  needle: string,
): boolean {
  const haystack = [entry.name, entry.repo ?? "", entry.license ?? "", theme?.title ?? "", theme?.description ?? ""]
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

function matchesBundle(bundle: ExtensionBundle, needle: string): boolean {
  return [bundle.id, bundle.title, bundle.description, bundle.category, ...bundle.packages]
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

/**
 * Build the extension catalog read model. `query` filters packages and bundles
 * case-insensitively; themes always stay visible because their previews are the
 * page's theme picker.
 */
export function createExtensionCatalog(input: CreateExtensionCatalogInput): ExtensionCatalog {
  const needle = (input.query ?? "").trim().toLowerCase();
  const themesByPackage = new Map(input.themes.map((theme) => [theme.package, theme]));
  const entries = input.registry.list().filter((entry) => entry.source === "extension");

  const packages: ExtensionCatalogPackage[] = entries
    .map((entry) => {
      const theme = themesByPackage.get(entry.name) ?? null;
      return {
        name: entry.name,
        title: theme?.title ?? entry.name,
        description: theme?.description ?? `扩展包 ${entry.name}`,
        license: entry.license ?? null,
        publicAllowed: entry.publicAllowed === true,
        i18nStatus: i18nStatusOf(entry),
        experimental: entry.experimental === true || theme?.experimental === true,
        repo: entry.repo ?? null,
        ref: entry.ref ?? null,
        targets: entry.targets ?? [],
        theme,
      };
    })
    .filter((item) =>
      needle ? matchesPackage({ name: item.name, repo: item.repo, license: item.license }, item.theme, needle) : true,
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  const bundles = input.bundles
    .filter((bundle) => (needle ? matchesBundle(bundle, needle) : true))
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));

  const counts: ExtensionCatalogCounts = {
    packages: entries.length,
    publicPackages: entries.filter((entry) => entry.publicAllowed === true).length,
    experimental: entries.filter((entry) => entry.experimental === true).length,
    bundles: input.bundles.length,
    themes: input.themes.length,
  };

  return {
    query: input.query ?? "",
    packages,
    bundles,
    themes: input.themes.slice().sort((a, b) => Number(b.default) - Number(a.default) || a.title.localeCompare(b.title)),
    counts,
  };
}

/** The single default theme of the curated set, for the extension page header. */
export function extensionDefaultTheme(themes: readonly ExtensionTheme[]): ExtensionTheme | null {
  return defaultTheme(themes);
}
