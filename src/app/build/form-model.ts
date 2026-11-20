/**
 * Pure form state for the Simple/Advanced build form (ticket 15).
 *
 * Everything here is serializable and client-safe: the React components hold
 * one `BuildFormState`, call these helpers for every transition, and build the
 * V2 plan/submit body from it. Keeping the transitions out of JSX makes the
 * bundle/theme/mode behaviour testable without a DOM.
 */
import type { NetworkInput } from "@/lib/build/types";
import { variantForImageType } from "@/lib/build/artifact-name";
import type { BasePresetId } from "@/lib/domain/types";
import type {
  BuildUiOptions,
  BundleOption,
  ProfileOption,
  SelectedVariant,
  TargetOption,
  ThemeOption,
  VariantOption,
} from "@/lib/build/ui-types";

export type FormMode = "simple" | "advanced";
export type Visibility = "private" | "public";

export interface ReleaseOption {
  version: string;
  active: boolean;
  snapshotAvailable: boolean;
}

export interface BuildFormState {
  mode: FormMode;
  targetId: string;
  profileId: string;
  release: string;
  kernelLine: string;
  variant: SelectedVariant;
  overlaySizeMb: number;
  basePreset: BasePresetId;
  modes: string[];
  hostname: string;
  timezone: string;
  lanIp: string;
  netmask: string;
  network: NetworkInput;
  packages: string[];
  /** Negative package list applied before dependency resolution. */
  removePackages: string[];
  bundles: string[];
  themePackage: string | null;
  visibility: Visibility;
}

export interface PackageSearchItem {
  name: string;
  description: string;
  source: string;
  license: string | null;
  i18nStatus: "curated" | "auto" | "unreviewed" | null;
}

export const DEFAULT_NETWORK: NetworkInput = {
  lan: { dhcp: { enabled: true, start: 100, limit: 150, lease: "12h" } },
  wan: { protocol: "dhcp" },
  dns: [],
  ipv6: "disabled",
};

export function findTarget(ui: BuildUiOptions, targetId: string): TargetOption | null {
  return ui.targets.find((target) => target.id === targetId) ?? null;
}

export function findProfile(ui: BuildUiOptions, targetId: string, profileId: string): ProfileOption | null {
  return findTarget(ui, targetId)?.profiles.find((profile) => profile.id === profileId) ?? null;
}

function firstBuildableProfile(target: TargetOption | null): ProfileOption | null {
  if (!target) return null;
  return target.profiles.find((profile) => profile.buildable) ?? target.profiles[0] ?? null;
}

function preferredKernelLine(profile: ProfileOption | null): string {
  if (!profile) return "6.12";
  const offered = profile.kernelLines.filter((line) => line.offered);
  return (offered.find((line) => line.id === "6.12") ?? offered[0] ?? profile.kernelLines[0])?.id ?? "6.12";
}

function preferredVariant(profile: ProfileOption | null): SelectedVariant {
  const supported = profile?.variants.find((variant) => variant.supported);
  return supported
    ? { boot: supported.boot, filesystem: supported.filesystem, artifact: supported.artifact }
    : { boot: "efi", filesystem: "ext4", artifact: "combined" };
}

function defaultOverlay(profile: ProfileOption | null): number {
  return profile?.overlay.defaultMb ?? 1024;
}

/** Map a V1 catalog image format id onto a V2 variant (for `?from=<v1 build>`). */
export function variantFromImageType(imageType: string | undefined): SelectedVariant | null {
  switch (imageType) {
    case "ext4-efi":
    case "squashfs-efi":
    case "rootfs-tar":
      return variantForImageType(imageType);
    default:
      return null;
  }
}

export interface InitialBuildConfig {
  profile: string;
  imageType: string;
  hostname: string;
  timezone: string;
  lanIp: string;
  netmask: string;
  packages: string[];
  visibility?: Visibility;
}

export function defaultBuildForm(
  ui: BuildUiOptions,
  releases: readonly ReleaseOption[],
  initial?: InitialBuildConfig | null,
): BuildFormState {
  const initialTarget =
    ui.targets.find((target) => target.profiles.some((profile) => profile.id === initial?.profile)) ??
    ui.targets.find((target) => target.buildable) ??
    ui.targets[0];
  const target = initialTarget ?? null;
  const profile =
    (initial && target?.profiles.find((item) => item.id === initial.profile)) ?? firstBuildableProfile(target);
  const variant =
    (initial ? variantFromImageType(initial.imageType) : null) ?? preferredVariant(profile);
  const release =
    releases.find((option) => option.active)?.version ?? releases[0]?.version ?? "25.12.2";
  return {
    mode: "simple",
    targetId: target?.id ?? "",
    profileId: profile?.id ?? "",
    release,
    kernelLine: preferredKernelLine(profile),
    variant,
    overlaySizeMb: defaultOverlay(profile),
    basePreset: "minimal",
    modes: [],
    hostname: initial?.hostname ?? "ImmortalWrt",
    timezone: initial?.timezone ?? "Asia/Shanghai",
    lanIp: initial?.lanIp ?? "192.168.1.1",
    netmask: initial?.netmask ?? "255.255.255.0",
    network: DEFAULT_NETWORK,
    packages: initial ? [...initial.packages] : [],
    removePackages: [],
    bundles: [],
    themePackage: null,
    visibility: initial?.visibility ?? "private",
  };
}

/** Switch target and re-derive profile/kernel/variant from the new capabilities. */
export function selectTarget(state: BuildFormState, ui: BuildUiOptions, targetId: string): BuildFormState {
  const target = findTarget(ui, targetId);
  const profile = firstBuildableProfile(target);
  return {
    ...state,
    targetId,
    profileId: profile?.id ?? "",
    kernelLine: preferredKernelLine(profile),
    variant: preferredVariant(profile),
    overlaySizeMb: defaultOverlay(profile),
  };
}

export function selectProfile(state: BuildFormState, ui: BuildUiOptions, profileId: string): BuildFormState {
  const profile = findProfile(ui, state.targetId, profileId);
  return {
    ...state,
    profileId,
    kernelLine: preferredKernelLine(profile),
    variant: preferredVariant(profile),
    overlaySizeMb: defaultOverlay(profile),
  };
}

export function selectVariant(state: BuildFormState, variant: VariantOption): BuildFormState {
  return {
    ...state,
    variant: { boot: variant.boot, filesystem: variant.filesystem, artifact: variant.artifact },
  };
}

export function toggleMode(state: BuildFormState, modeId: string): BuildFormState {
  return {
    ...state,
    modes: state.modes.includes(modeId)
      ? state.modes.filter((id) => id !== modeId)
      : [...state.modes, modeId],
  };
}

export function addPackage(state: BuildFormState, name: string): BuildFormState {
  const value = name.trim();
  if (!value || state.packages.includes(value)) return state;
  return { ...state, packages: [...state.packages, value] };
}

export function removePackage(state: BuildFormState, name: string): BuildFormState {
  const theme = state.themePackage === name ? null : state.themePackage;
  return { ...state, packages: state.packages.filter((item) => item !== name), themePackage: theme };
}

/** Bundle ownership: a package is removable when no other selected bundle or theme owns it. */
function ownedBySelection(name: string, state: BuildFormState, ui: BuildUiOptions, ignoredBundle: string): string[] {
  const owners: string[] = [];
  for (const bundle of ui.bundles) {
    if (bundle.id === ignoredBundle) continue;
    if (state.bundles.includes(bundle.id) && bundle.packages.includes(name)) owners.push(bundle.id);
  }
  if (state.themePackage === name) owners.push("theme");
  return owners;
}

export function toggleBundle(state: BuildFormState, ui: BuildUiOptions, bundle: BundleOption): BuildFormState {
  if (state.bundles.includes(bundle.id)) {
    const removed = new Set(bundle.packages);
    const nextPackages = state.packages.filter(
      (name) => !removed.has(name) || ownedBySelection(name, state, ui, bundle.id).length > 0,
    );
    return {
      ...state,
      bundles: state.bundles.filter((id) => id !== bundle.id),
      packages: nextPackages,
    };
  }
  const nextPackages = [...state.packages];
  for (const name of bundle.packages) {
    if (!nextPackages.includes(name)) nextPackages.push(name);
  }
  return { ...state, bundles: [...state.bundles, bundle.id], packages: nextPackages };
}

/** Select one theme (or deselect when clicking the selected theme). */
export function selectTheme(state: BuildFormState, theme: ThemeOption): BuildFormState {
  const withoutOld = state.themePackage
    ? state.packages.filter((name) => name !== state.themePackage)
    : [...state.packages];
  if (state.themePackage === theme.package) {
    return { ...state, themePackage: null, packages: withoutOld };
  }
  if (!withoutOld.includes(theme.package)) withoutOld.push(theme.package);
  return { ...state, themePackage: theme.package, packages: withoutOld };
}

export function selectedOverlaySizeMb(state: BuildFormState, profile: ProfileOption | null): number | null {
  if (state.variant.artifact === "rootfs") return null;
  const range = profile?.overlay;
  if (!range) return state.overlaySizeMb;
  const aligned = Math.min(
    Math.max(state.overlaySizeMb, range.minMb),
    range.maxMb,
  );
  return aligned;
}

/** The exact V2 planner form the browser POSTs to `/api/build/plan` and `/api/builds`. */
export function buildSubmitBody(
  state: BuildFormState,
  ui: BuildUiOptions,
  rootPassword: string,
): Record<string, unknown> {
  const profile = findProfile(ui, state.targetId, state.profileId);
  const modes = state.modes.flatMap((id) => {
    const mode = profile?.modes.find((item) => item.id === id);
    return mode ? [{ id: mode.id, layer: mode.layer, title: mode.title }] : [];
  });
  const overlay = selectedOverlaySizeMb(state, profile);
  return {
    schemaVersion: 2,
    target: state.targetId,
    profile: state.profileId,
    baseVersion: state.release,
    kernelLine: state.kernelLine,
    imageVariant: {
      boot: state.variant.boot,
      filesystem: state.variant.filesystem,
      artifact: state.variant.artifact,
      ...(overlay !== null ? { overlaySizeMb: overlay } : {}),
    },
    basePreset: state.basePreset,
    modes,
    ...(state.mode === "advanced" ? { network: state.network } : {}),
    hostname: state.hostname,
    timezone: state.timezone,
    lanIp: state.lanIp,
    netmask: state.netmask,
    rootPassword,
    packages: state.packages,
    ...(state.removePackages.length > 0 ? { removePackages: state.removePackages } : {}),
    visibility: state.visibility,
  };
}

/** Packages a bundle or theme adds, used for preview chips without duplicating logic. */
export function expandedPackages(state: BuildFormState, ui: BuildUiOptions): string[] {
  const result = [...state.packages];
  for (const bundle of ui.bundles) {
    if (!state.bundles.includes(bundle.id)) continue;
    for (const name of bundle.packages) if (!result.includes(name)) result.push(name);
  }
  if (state.themePackage && !result.includes(state.themePackage)) result.push(state.themePackage);
  return result;
}

export const SOURCE_LABELS: Record<string, string> = {
  official: "官方",
  dllkids: "dllkids",
  supplement: "自有",
  extension: "扩展",
};

export function sourceLabel(source: string | null | undefined): string {
  return source ? (SOURCE_LABELS[source] ?? source) : "未知来源";
}

/**
 * i18n badges for third-party packages (ADR 0003). The badge is metadata only:
 * the package's license and source stay visible next to it and no admission or
 * license rule is relaxed.
 */
export function i18nBadges(status: PackageSearchItem["i18nStatus"]): string[] {
  if (status === "auto") return ["自动翻译"];
  if (status === "unreviewed") return ["未审核"];
  return [];
}
