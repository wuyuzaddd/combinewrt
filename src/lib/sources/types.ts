import type { PackageSource } from "../catalog/types";

/**
 * How a package gets into an image. `prebuilt` consumes a pinned binary,
 * `rebuild` compiles it from a registered source recipe, and `blocked` means
 * the planner must refuse it. A `prebuilt` request may fall back to `rebuild`
 * when the binary is unavailable for the selected target/kernel line (ADR 0005).
 */
export type AcquisitionStrategy = "prebuilt" | "rebuild" | "blocked";

/**
 * The four acquisition layers V2 knows about: the three V1 catalog sources plus
 * `extension`, the curated extension feed (ticket 12).
 */
export type SourceLayer = PackageSource;

/**
 * How much of an extension package's upstream text has been reviewed (ticket
 * 12, ADR 0003). This is display metadata only: it never changes the source,
 * licence, ABI or `publicAllowed` decisions.
 */
export type I18nStatus = "curated" | "auto" | "unreviewed";

export const I18N_STATUSES: readonly I18nStatus[] = ["curated", "auto", "unreviewed"];

/**
 * One package as registered in `config/sources/registry.json`. Ticket 12 owns
 * the checked-in document; the planner only reads it through `SourceRegistry`.
 */
export interface SourceRegistryEntry {
  name: string;
  source: SourceLayer;
  /** Immutable upstream identity of the prebuilt artifact (feed commit / index digest / 40-hex ref). */
  pin?: string | null;
  /** SPDX identifier of the package licence. */
  license?: string | null;
  /** Whether the package may appear in a public image. */
  publicAllowed?: boolean;
  /** Target ids this entry is valid for; omitted means every target. */
  targets?: readonly string[];
  /** Kernel line ids this entry is valid for; omitted means every kernel line. */
  kernelLines?: readonly string[];
  /** Strategy the registry requests; the planner may fall back to `rebuild`. */
  strategy: AcquisitionStrategy;
  /** Source recipe used when rebuilding; absent means the package cannot be rebuilt. */
  recipe?: string | null;
  /** Kernel ABI (vermagic) the prebuilt artifact was compiled against. */
  abi?: string | null;
  /** Source patches applied before building (ticket 12). */
  patches?: readonly string[];

  // ---- extension layer (ticket 12) -------------------------------------
  /** Upstream GitHub repository (`owner/name`) an extension package is built from. */
  repo?: string | null;
  /** Pinned 40-hex upstream commit the extension package is built from. */
  ref?: string | null;
  /** Package directory inside `repo`; `.` means the repository root. */
  subdir?: string | null;
  /** sha256 of `recipe`, so the acquisition identity cannot drift silently. */
  recipeHash?: string | null;
  /** How much of the upstream text is curated; metadata only (ADR 0003). */
  i18nStatus?: I18nStatus;
  /** Marks an extension package the catalog surfaces as experimental. */
  experimental?: boolean;
}

export interface SourceQuery {
  /** Target id (`x86/64`); used to prefer/validate target-scoped records. */
  target?: string;
  /** Kernel line id (`6.12`). */
  kernelLine?: string;
  /** Restrict the lookup to one source layer. */
  source?: SourceLayer | null;
}

/**
 * Minimal read interface of the unified source registry. Ticket 12 swaps in the
 * real checked-in registry; the planner must keep working with an empty one.
 */
export interface SourceRegistry {
  lookup(name: string, query?: SourceQuery): SourceRegistryEntry | null;
  /**
   * Every registered entry, in document order. The supplement watch derives
   * its rebuild recipe from the `supplement` layer (ticket 11).
   */
  list(): readonly SourceRegistryEntry[];
}

/** A single registry problem, reported with the JSON path that caused it. */
export interface SourceRegistryViolation {
  path: string;
  message: string;
}

/** Result of validating a registry document: parsed entries plus every problem. */
export interface ParsedSourceRegistry {
  entries: SourceRegistryEntry[];
  violations: SourceRegistryViolation[];
}
