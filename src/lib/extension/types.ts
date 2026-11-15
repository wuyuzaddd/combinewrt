/** Extension layer metadata (ticket 12): themes and one-click bundles. */

export type ExtensionBundleCategory = "proxy" | "nas" | "download" | "monitor" | "theme" | "system";

export const EXTENSION_BUNDLE_CATEGORIES: readonly ExtensionBundleCategory[] = [
  "proxy",
  "nas",
  "download",
  "monitor",
  "theme",
  "system",
];

/** Feed tests a bundle must declare (ticket 12). */
export type ExtensionBundleTest = "dependency" | "installability";

export const EXTENSION_BUNDLE_TESTS: readonly ExtensionBundleTest[] = ["dependency", "installability"];

/** One curated bundle: a named package set that expands to plain package requests. */
export interface ExtensionBundle {
  id: string;
  title: string;
  description: string;
  category: ExtensionBundleCategory;
  /** Registry package names; the bundle owns no scripts or hooks of its own. */
  packages: readonly string[];
  targets: readonly string[];
  /** SPDX identifier covering the whole bundle. */
  license: string;
  publicAllowed: boolean;
  /** Feed tests that gate the bundle; both are required for every bundle. */
  tests: readonly ExtensionBundleTest[];
  notes?: string;
}

export interface ExtensionTheme {
  /** Registry package name of the theme (`luci-theme-*`). */
  package: string;
  title: string;
  description: string;
  /** Site-relative preview image path. */
  preview: string;
  /** LuCI release lines this theme supports. */
  luciVersions: readonly string[];
  /** Exactly one installed theme may be the default theme. */
  default: boolean;
  experimental?: boolean;
}

/** Violations reported by theme/bundle validation, with a JSON path. */
export interface ExtensionViolation {
  path: string;
  message: string;
}
