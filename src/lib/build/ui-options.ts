import type { CapabilityRegistry } from "../catalog/capabilities";
import { supportsMode, supportsVariant } from "../catalog/capabilities";
import type { BasePresetId, ImageVariant } from "../domain/types";
import { BASE_PRESET_IDS } from "../domain/types";
import type { ExtensionBundle, ExtensionTheme } from "../extension/types";
import type { CommonPreset } from "../presets/common";
import type { SourceRegistry } from "../sources/types";
import { BASE_PRESET_FEATURES, BASE_PRESET_TITLES, type ModeDeclaration } from "./modes";
import { filterTargets } from "./target-filter";
import type {
  BasePresetOption,
  BuildUiOptions,
  BundleOption,
  CommonGroupOption,
  CommonPackageOption,
  KernelLineOption,
  ModeOption,
  PackageApplicability,
  PackageApplicabilityInput,
  ProfileOption,
  SelectedVariant,
  TargetOption,
  ThemeOption,
  VariantOption,
} from "./ui-types";

const BOOT_LABELS: Record<string, string> = { efi: "EFI", legacy: "Legacy" };
const FILESYSTEM_LABELS: Record<string, string> = { ext4: "ext4", squashfs: "squashfs" };
const ARTIFACT_LABELS: Record<string, string> = {
  combined: "combined",
  rootfs: "rootfs tar",
  vmdk: "VMDK",
  qcow2: "qcow2",
  emmc: "eMMC",
};

export function variantKey(variant: SelectedVariant): string {
  return `${variant.boot}/${variant.filesystem}/${variant.artifact}`;
}

export function variantLabel(variant: SelectedVariant): string {
  return `${BOOT_LABELS[variant.boot] ?? variant.boot} · ${FILESYSTEM_LABELS[variant.filesystem] ?? variant.filesystem} · ${
    ARTIFACT_LABELS[variant.artifact] ?? variant.artifact
  }`;
}

/** The kernel line the UI previews variants against: the profile's first non-experimental line. */
function previewKernelLine(profile: { kernelLines: readonly string[] }, registry: CapabilityRegistry): string {
  const nonExperimental = profile.kernelLines.find(
    (id) => registry.kernelLines.find((line) => line.id === id)?.experimental === false,
  );
  return nonExperimental ?? profile.kernelLines[0] ?? "6.12";
}

function profilePlaceholderReason(profile: { status: string }): string | null {
  if (profile.status === "placeholder") return "占位 profile：V2.0 只建模，不参与真实构建";
  return null;
}

function targetPlaceholderReason(target: { status: string }): string | null {
  if (target.status === "placeholder") return "占位 target：V2.0 只建模，不参与真实构建";
  return null;
}

function variantOptions(
  registry: CapabilityRegistry,
  targetId: string,
  profile: { id: string; status: string; variants: CapabilityRegistry["targets"][number]["profiles"][number]["variants"]; kernelLines: readonly string[] },
): VariantOption[] {
  const placeholder = profile.status === "placeholder";
  return profile.variants.map((declared) => {
    const variant: ImageVariant = {
      boot: declared.boot,
      filesystem: declared.filesystem,
      artifact: declared.artifact,
    };
    let supported = declared.supported;
    let experimental = declared.experimental;
    let disabledReason: string | null = null;

    if (placeholder) {
      supported = false;
      disabledReason = "占位 profile：V2.0 不构建此变体";
    } else {
      // `supportsVariant` re-checks the declaration (including overlay rules and
      // the deferred eMMC note) and hands back the readable reason.
      const support = supportsVariant({ targetId, id: profile.id }, previewKernelLine(profile, registry), variant, registry);
      supported = support.supported;
      experimental = support.supported ? support.experimental : declared.experimental;
      if (!support.supported) disabledReason = support.reason.message;
    }

    return {
      key: variantKey(variant),
      boot: declared.boot,
      filesystem: declared.filesystem,
      artifact: declared.artifact,
      supported,
      experimental,
      disabledReason,
      label: variantLabel(variant),
    };
  });
}

function kernelLineOptions(
  registry: CapabilityRegistry,
  profile: { kernelLines: readonly string[]; status: string },
): KernelLineOption[] {
  return registry.kernelLines.map((line) => {
    const offered = profile.kernelLines.includes(line.id);
    const reason = offered
      ? null
      : profile.status === "placeholder"
        ? "占位 profile：V2.0 不构建"
        : `该 profile 未提供内核线 ${line.id}`;
    return {
      id: line.id,
      version: line.version,
      engine: line.engine,
      experimental: line.experimental,
      offered,
      disabledReason: reason,
    };
  });
}

function modeOptions(
  registry: CapabilityRegistry,
  declarations: readonly ModeDeclaration[],
  targetId: string,
  profile: { id: string; status: string },
): ModeOption[] {
  const byId = new Map(declarations.map((declaration) => [declaration.id, declaration]));
  const placeholderReason = profilePlaceholderReason(profile);
  return registry.modes.map((registryMode) => {
    const declaration = byId.get(registryMode.id);
    let offered = false;
    let disabledReason: string | null = placeholderReason;
    let experimental = registryMode.experimental;
    if (!placeholderReason) {
      const support = supportsMode({ targetId, id: profile.id }, registryMode.id, registry);
      offered = support.supported;
      if (support.supported) {
        experimental = support.experimental;
      } else {
        disabledReason = support.reason.message;
      }
    }
    return {
      id: registryMode.id,
      title: declaration?.title ?? registryMode.title,
      description: declaration?.description ?? null,
      layer: registryMode.layer,
      experimental,
      packages: declaration?.packages ? [...declaration.packages] : [],
      requires: declaration?.requires ? [...declaration.requires] : [],
      requiresAny: declaration?.requiresAny ? declaration.requiresAny.map((group) => [...group]) : [],
      conflicts: declaration?.conflicts ? [...declaration.conflicts] : [],
      exclusiveGroup: declaration?.exclusiveGroup ?? null,
      offered,
      disabledReason: offered ? null : (disabledReason ?? "该 profile 未提供此模式"),
    };
  });
}

function bundleOptions(bundles: readonly ExtensionBundle[]): BundleOption[] {
  return bundles.map((bundle) => ({
    id: bundle.id,
    title: bundle.title,
    description: bundle.description,
    category: bundle.category,
    packages: [...bundle.packages],
    targets: [...bundle.targets],
    license: bundle.license,
    publicAllowed: bundle.publicAllowed,
  }));
}

function themeOptions(themes: readonly ExtensionTheme[]): ThemeOption[] {
  return themes.map((theme) => ({
    package: theme.package,
    title: theme.title,
    description: theme.description,
    preview: theme.preview,
    luciVersions: [...theme.luciVersions],
    default: theme.default,
    experimental: theme.experimental === true,
  }));
}

function commonGroupOptions(preset: CommonPreset): CommonGroupOption[] {
  return preset.groups.map((group) => ({
    id: group.id,
    title: group.title,
    description: group.description ?? null,
    packages: group.packages.map((pkg): CommonPackageOption => ({
      name: pkg.name,
      description: pkg.description,
      license: pkg.license,
      source: pkg.source,
      targets: pkg.targets ? [...pkg.targets] : null,
      kernelLines: pkg.kernelLines ? [...pkg.kernelLines] : null,
      conflicts: pkg.conflicts ? [...pkg.conflicts] : null,
    })),
  }));
}

function basePresetOptions(): BasePresetOption[] {
  return BASE_PRESET_IDS.map((id) => ({
    id,
    title: BASE_PRESET_TITLES[id],
    features: [...BASE_PRESET_FEATURES[id]],
  }));
}

export interface BuildUiOptionsInput {
  registry: CapabilityRegistry;
  declarations: readonly ModeDeclaration[];
  bundles: readonly ExtensionBundle[];
  themes: readonly ExtensionTheme[];
  common: CommonPreset;
}

/**
 * Build the serializable read model once per request. Capability decisions are
 * made by the registry, not recomputed in the browser.
 */
export function createBuildUiOptions(input: BuildUiOptionsInput): BuildUiOptions {
  const targets: TargetOption[] = input.registry.targets.map((target) => {
    const targetReason = targetPlaceholderReason(target);
    return {
      id: target.id,
      architecture: target.architecture,
      subtarget: target.subtarget,
      title: target.title,
      status: target.status,
      buildable: targetReason === null,
      profiles: target.profiles.map((profile): ProfileOption => {
        const disabledReason = targetReason ?? profilePlaceholderReason(profile);
        return {
          targetId: target.id,
          id: profile.id,
          title: profile.title,
          status: profile.status,
          capabilities: [...profile.capabilities],
          buildable: disabledReason === null,
          disabledReason,
          overlay: { ...profile.overlay },
          variants: variantOptions(input.registry, target.id, profile),
          kernelLines: kernelLineOptions(input.registry, profile),
          modes: modeOptions(input.registry, input.declarations, target.id, profile),
        };
      }),
    };
  });

  return {
    targets,
    basePresets: basePresetOptions(),
    bundles: bundleOptions(input.bundles),
    themes: themeOptions(input.themes),
    commonGroups: commonGroupOptions(input.common),
  };
}

export { filterTargets };

/** Curated applicability rules, by package name. */
export function curatedPackageMap(
  common: CommonPreset,
): Map<string, { name: string; targets?: readonly string[]; kernelLines?: readonly string[] }> {
  const map = new Map<string, { name: string; targets?: readonly string[]; kernelLines?: readonly string[] }>();
  for (const group of common.groups) {
    for (const pkg of group.packages) map.set(pkg.name, pkg);
  }
  return map;
}

/**
 * Whether the current target/kernel line may select a package. Curated packages
 * carry reviewed restrictions; registry entries carry their own targets/kernel
 * lines. A package absent from both registries is left to the planner (which
 * answers 409 when it cannot resolve a source).
 */
export function packageApplicability(
  name: string,
  input: PackageApplicabilityInput,
): PackageApplicability {
  const { targetId, kernelLine } = input;
  const common = input.common as CommonPreset | undefined;
  if (common && targetId) {
    const curated = curatedPackageMap(common).get(name);
    if (curated) {
      if (curated.targets && !curated.targets.includes(targetId)) {
        return {
          allowed: false,
          reason: `策展包 ${name} 仅适用于 ${curated.targets.join(", ")}`,
        };
      }
      if (curated.kernelLines && kernelLine && !curated.kernelLines.includes(kernelLine)) {
        return {
          allowed: false,
          reason: `策展包 ${name} 仅适用于内核 ${curated.kernelLines.join(", ")}`,
        };
      }
    }
  }

  const record = input.registry?.lookup(name);
  if (record) {
    if (record.targets && targetId && !record.targets.includes(targetId)) {
      return { allowed: false, reason: `包 ${name} 的 registry 目标不含 ${targetId}` };
    }
    if (record.kernelLines && kernelLine && !record.kernelLines.includes(kernelLine)) {
      return { allowed: false, reason: `包 ${name} 的 registry 内核线不含 ${kernelLine}` };
    }
  }
  return { allowed: true, reason: null };
}

export type { ModeDeclaration, SourceRegistry };
export type { BasePresetId };
