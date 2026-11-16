/**
 * Serializable build-UI read model (ticket 15).
 *
 * These types cross the server/client boundary: the build page renders them on
 * the server from the capability registry and extension metadata, then hands
 * them to the client form as props. They deliberately contain no functions, no
 * file-system handles and no secrets.
 */
import type {
  ArtifactKind,
  BasePresetId,
  BootMode,
  BuildEngine,
  FilesystemKind,
  ImageVariant,
  ModeLayer,
} from "../domain/types";
import type { PackageSource } from "../catalog/types";

export interface VariantOption {
  /** Stable key `boot/filesystem/artifact`. */
  key: string;
  boot: BootMode;
  filesystem: FilesystemKind;
  artifact: ArtifactKind;
  supported: boolean;
  experimental: boolean;
  /** Human reason when `supported` is false; null otherwise. */
  disabledReason: string | null;
  label: string;
}

export interface KernelLineOption {
  id: string;
  version: string;
  engine: BuildEngine;
  experimental: boolean;
  /** Whether this profile offers the line at all. */
  offered: boolean;
  disabledReason: string | null;
}

/**
 * One configuration mode as the form renders it. `requires`/`conflicts` stay as
 * raw planner tokens: the client evaluates them against the current selection
 * with `mode-ui.ts`, so a mode can become unavailable when the user changes the
 * kernel line or the filesystem.
 */
export interface ModeOption {
  id: string;
  title: string;
  description: string | null;
  layer: ModeLayer;
  experimental: boolean;
  packages: string[];
  requires: string[];
  requiresAny: string[][];
  conflicts: string[];
  exclusiveGroup: string | null;
  /** False when the capability registry does not offer the mode to the profile. */
  offered: boolean;
  disabledReason: string | null;
}

export interface OverlayRange {
  minMb: number;
  maxMb: number;
  stepMb: number;
  defaultMb: number;
}

export interface ProfileOption {
  targetId: string;
  id: string;
  title: string;
  status: "verified" | "experimental" | "placeholder";
  capabilities: string[];
  buildable: boolean;
  disabledReason: string | null;
  overlay: OverlayRange;
  variants: VariantOption[];
  kernelLines: KernelLineOption[];
  modes: ModeOption[];
}

export interface TargetOption {
  id: string;
  architecture: string;
  subtarget: string;
  title: string;
  status: "verified" | "placeholder";
  buildable: boolean;
  profiles: ProfileOption[];
}

export interface BasePresetOption {
  id: BasePresetId;
  title: string;
  features: string[];
}

export interface BundleOption {
  id: string;
  title: string;
  description: string;
  category: string;
  packages: string[];
  targets: string[];
  license: string;
  publicAllowed: boolean;
}

export interface ThemeOption {
  package: string;
  title: string;
  description: string;
  preview: string;
  luciVersions: string[];
  default: boolean;
  experimental: boolean;
}

export interface CommonPackageOption {
  name: string;
  description: string;
  license: string;
  source: PackageSource;
  targets: string[] | null;
  kernelLines: string[] | null;
  conflicts: string[] | null;
}

export interface CommonGroupOption {
  id: string;
  title: string;
  description: string | null;
  packages: CommonPackageOption[];
}

export interface BuildUiOptions {
  targets: TargetOption[];
  basePresets: BasePresetOption[];
  bundles: BundleOption[];
  themes: ThemeOption[];
  commonGroups: CommonGroupOption[];
}

export interface TargetFilter {
  query?: string;
  capability?: string;
}

export interface PackageApplicabilityInput {
  common?: unknown;
  registry?: {
    lookup(name: string): { targets?: readonly string[]; kernelLines?: readonly string[] } | null;
  };
  targetId?: string;
  kernelLine?: string;
}

export interface PackageApplicability {
  allowed: boolean;
  reason: string | null;
}

/** Selected image variant in a form; the overlay size is only meaningful for some artifacts. */
export type SelectedVariant = Pick<ImageVariant, "boot" | "filesystem" | "artifact">;
