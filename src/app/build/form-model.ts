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
import type { BasePresetId, BaseChannel } from "@/lib/domain/types";
import { channelForVersion, resolveChannel } from "@/lib/build/channel";
import type {
  BuildUiOptions,
  BundleOption,
  ProfileOption,
  SelectedVariant,
  TargetOption,
  VariantOption,
} from "@/lib/build/ui-types";
import type { ModeNetworkPatch } from "@/lib/build/modes";

export type FormMode = "simple" | "advanced";
export type Visibility = "private" | "public";

export interface ReleaseOption {
  version: string;
  active: boolean;
  snapshotAvailable: boolean;
  /**
   * Channel of this base version (ticket 11). The Simple list only offers
   * release rows; a snapshot option can only appear as the labelled fallback
   * of a snapshot-only deployment, and selects an experimental plan.
   */
  channel?: BaseChannel;
}

/**
 * Simple-mode release list (ticket 11). Only release-channel base versions are
 * offered, so a rolling snapshot is never one dropdown away from a daily
 * build. When the deployment has no release row at all (a snapshot-only test
 * instance) the active row, or the catalog snapshot's own base version, is the
 * fallback; it keeps `channel: "snapshot"` and the UI labels it 实验.
 */
export function releaseOptions(
  baseVersions: readonly { version: string; channel?: BaseChannel }[],
  active: string,
  availableVersion: string,
): ReleaseOption[] {
  const channelOf = (entry: { version: string; channel?: BaseChannel }): BaseChannel =>
    resolveChannel(entry.version, entry);
  const toOption = (entry: { version: string; channel?: BaseChannel }): ReleaseOption => ({
    version: entry.version,
    active: entry.version === active,
    snapshotAvailable: entry.version === availableVersion || entry.version === active,
    channel: channelOf(entry),
  });

  const releases = baseVersions.filter((entry) => channelOf(entry) === "release");
  if (releases.length > 0) return releases.map(toOption);

  const activeRow = baseVersions.find((entry) => entry.version === active);
  if (activeRow) return [toOption(activeRow)];
  return [
    {
      version: availableVersion,
      active: true,
      snapshotAvailable: true,
      channel: channelForVersion(availableVersion),
    },
  ];
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
  /** Theme package applied at first boot; must also be installed in `packages`. */
  defaultTheme: string | null;
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
  /**
   * V1 format of a stored build. V2 records no longer store it, so the build
   * page derives it from the plan before handing the config over.
   */
  imageType?: string;
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
    defaultTheme: null,
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
  return {
    ...state,
    packages: state.packages.filter((item) => item !== name),
    defaultTheme: state.defaultTheme === name ? null : state.defaultTheme,
  };
}

/** Bundle ownership: a package is removable when no other selected bundle or theme owns it. */
function ownedBySelection(name: string, state: BuildFormState, ui: BuildUiOptions, ignoredBundle: string): string[] {
  const owners: string[] = [];
  for (const bundle of ui.bundles) {
    if (bundle.id === ignoredBundle) continue;
    if (state.bundles.includes(bundle.id) && bundle.packages.includes(name)) owners.push(bundle.id);
  }
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

/**
 * Apply a mode's declared network patch to the form, so selecting e.g. the
 * bypass mode also turns the LAN DHCP server off instead of leaving the form in
 * a state the planner would reject as a conflict.
 */
export function applyModeNetworkPatch(network: NetworkInput, patch: ModeNetworkPatch): NetworkInput {
  const dhcp = patch.lan?.dhcp
    ? {
        ...(network.lan?.dhcp ?? { enabled: true }),
        ...patch.lan.dhcp,
        enabled: patch.lan.dhcp.enabled ?? network.lan?.dhcp?.enabled ?? true,
      }
    : null;
  return {
    ...network,
    ...(dhcp ? { lan: { ...network.lan, dhcp } } : {}),
    ...(patch.wan
      ? {
          wan: {
            ...(network.wan ?? { protocol: "dhcp" as const }),
            ...patch.wan,
            protocol: patch.wan.protocol ?? network.wan?.protocol ?? ("dhcp" as const),
          },
        }
      : {}),
    ...(patch.dns ? { dns: [...patch.dns] } : {}),
    ...(patch.ipv6 ? { ipv6: patch.ipv6 } : {}),
    ...(patch.wifi ? { wifi: patch.wifi } : {}),
    ...(patch.switchPort ? { switchPort: patch.switchPort } : {}),
    ...(patch.bypass ? { bypass: patch.bypass } : {}),
  };
}

/**
 * Install or uninstall a theme package. Installing several themes at once is
 * allowed; the one applied at first boot is a separate choice.
 */
export function toggleThemePackage(state: BuildFormState, name: string): BuildFormState {
  if (state.packages.includes(name)) {
    return {
      ...state,
      packages: state.packages.filter((item) => item !== name),
      defaultTheme: state.defaultTheme === name ? null : state.defaultTheme,
    };
  }
  return { ...state, packages: [...state.packages, name] };
}

/** Choose the applied theme, or `null` to leave the system default alone. */
export function selectDefaultTheme(state: BuildFormState, name: string | null): BuildFormState {
  if (name !== null && !state.packages.includes(name)) return state;
  return { ...state, defaultTheme: name };
}

/** Theme packages currently installed, in selection order. */
export function installedThemes(state: BuildFormState): string[] {
  return state.packages.filter((name) => name.startsWith("luci-theme-"));
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

/**
 * One thing the browser can fix before asking the server for a plan.
 *
 * The plan form used to disable its button instead of saying what was wrong, so
 * a missing password looked like "the button is broken". Validation is a pure
 * function of the form state so the UI can list every problem at once, and so
 * the same list can be shown before a plan and before a dispatch.
 */
export interface FormIssue {
  /** Stable field key, e.g. `target` or `rootPassword`. */
  field: string;
  /** Section/field name shown to the user. */
  label: string;
  message: string;
}

const HOSTNAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;

function isIpv4(value: string): boolean {
  return IPV4_RE.test(value) && value.split(".").every((part) => Number(part) <= 255);
}

const MIN_PASSWORD = 8;

/** Every problem that must be fixed before a build plan can be generated. */
export function validateBuildForm(
  state: BuildFormState,
  ui: BuildUiOptions,
  rootPassword: string,
): FormIssue[] {
  const issues: FormIssue[] = [];
  const target = findTarget(ui, state.targetId);
  if (!target) {
    issues.push({ field: "target", label: "目标设备", message: "还没有选择目标设备" });
  } else if (!target.buildable) {
    issues.push({
      field: "target",
      label: "目标设备",
      message: `${target.title} 当前不可构建，请换一个目标设备`,
    });
  }

  const profile = findProfile(ui, state.targetId, state.profileId);
  if (!profile) {
    issues.push({ field: "profile", label: "设备 profile", message: "还没有选择设备 profile" });
  } else if (!profile.buildable) {
    issues.push({
      field: "profile",
      label: "设备 profile",
      message: `${profile.title} 当前不可构建${profile.disabledReason ? `：${profile.disabledReason}` : ""}`,
    });
  }

  if (!state.release) {
    issues.push({ field: "release", label: "目录基线", message: "还没有选择目录基线版本" });
  }

  const variant = profile?.variants.find(
    (item) =>
      item.boot === state.variant.boot &&
      item.filesystem === state.variant.filesystem &&
      item.artifact === state.variant.artifact,
  );
  if (!variant) {
    issues.push({ field: "variant", label: "镜像变体", message: "还没有选择镜像变体" });
  } else if (!variant.supported) {
    issues.push({
      field: "variant",
      label: "镜像变体",
      message: `${variant.label} 当前不受支持${variant.disabledReason ? `：${variant.disabledReason}` : ""}`,
    });
  }

  if (state.mode === "advanced") {
    const line = profile?.kernelLines.find((item) => item.id === state.kernelLine);
    if (!line) {
      issues.push({ field: "kernelLine", label: "内核线", message: "还没有选择内核线" });
    } else if (!line.offered) {
      issues.push({
        field: "kernelLine",
        label: "内核线",
        message: `${line.id} 当前不提供${line.disabledReason ? `：${line.disabledReason}` : ""}`,
      });
    }
  }

  if (profile && state.variant.artifact !== "rootfs") {
    const range = profile.overlay;
    if (
      Number.isFinite(state.overlaySizeMb) &&
      range &&
      (state.overlaySizeMb < range.minMb || state.overlaySizeMb > range.maxMb)
    ) {
      issues.push({
        field: "overlaySizeMb",
        label: "覆盖分区大小",
        message: `需在 ${range.minMb}–${range.maxMb} MB 之间（当前 ${state.overlaySizeMb} MB）`,
      });
    }
  }

  if (!HOSTNAME_RE.test(state.hostname)) {
    issues.push({
      field: "hostname",
      label: "主机名",
      message: "只能包含字母、数字和连字符，且不能以连字符开头或结尾（1–63 个字符）",
    });
  }

  if (state.mode === "advanced") {
    if (state.lanIp && !isIpv4(state.lanIp)) {
      issues.push({ field: "lanIp", label: "LAN IP", message: "不是合法的 IPv4 地址" });
    }
    if (state.netmask && !isIpv4(state.netmask)) {
      issues.push({ field: "netmask", label: "子网掩码", message: "不是合法的 IPv4 地址" });
    }
  }

  if (rootPassword.length < MIN_PASSWORD) {
    issues.push({
      field: "rootPassword",
      label: "root 密码",
      message: `至少 ${MIN_PASSWORD} 位（当前 ${rootPassword.length} 位）`,
    });
  }

  return issues;
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
    ...(state.defaultTheme ? { theme: state.defaultTheme } : {}),
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
