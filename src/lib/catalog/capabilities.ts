import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import type { DeviceProfile, ImageVariant, KernelLine } from "../domain/types";

/**
 * Checked-in capability registry.
 *
 * `config/capabilities/targets.json` is the single authority for which image
 * variants, kernel lines and configuration presets a target/profile may offer.
 * The UI, planner and workflows must ask this module instead of guessing or
 * reading upstream `profiles.json` at runtime.
 */

export const DEFAULT_CAPABILITIES_PATH = "config/capabilities/targets.json";

/** Default path of the checked-in registry, resolved from the process cwd. */
export function capabilitiesFilePath(override?: string): string {
  return resolve(process.cwd(), override ?? DEFAULT_CAPABILITIES_PATH);
}

const overlaySchema = z
  .object({
    minMb: z.number().int().positive(),
    maxMb: z.number().int().positive(),
    stepMb: z.number().int().positive(),
    defaultMb: z.number().int().positive(),
  })
  .strict();

const variantSchema = z
  .object({
    boot: z.enum(["efi", "legacy"]),
    filesystem: z.enum(["ext4", "squashfs"]),
    artifact: z.enum(["combined", "rootfs", "vmdk", "qcow2", "emmc"]),
    supported: z.boolean(),
    experimental: z.boolean(),
    /**
     * How this combination is verified: a test name, a checked upstream
     * artifact name, or an explicit deferral. It must never be empty.
     */
    verifiedBy: z.string().min(1),
    notes: z.string().optional(),
  })
  .strict();

const modeOfferSchema = z
  .object({
    id: z.string().min(1),
    experimental: z.boolean().optional(),
  })
  .strict();

const modeSchema = z
  .object({
    id: z.string().min(1),
    layer: z.enum(["file/board", "package/kernel", "kernel/config"]),
    title: z.string().min(1),
    experimental: z.boolean(),
    /** A mode that needs kernel configuration can only run on the source-build engine. */
    requiresEngine: z.enum(["imagebuilder", "source"]).optional(),
  })
  .strict();

const kernelLineSchema = z
  .object({
    id: z.string().min(1),
    version: z.enum(["6.6", "6.12", "6.18"]),
    engine: z.enum(["imagebuilder", "source"]),
    experimental: z.boolean(),
    sourceRecipeRef: z.string().min(1).optional(),
  })
  .strict();

const profileSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    status: z.enum(["verified", "experimental", "placeholder"]),
    capabilities: z.array(z.string().min(1)),
    overlay: overlaySchema,
    kernelLines: z.array(z.string().min(1)),
    modes: z.array(modeOfferSchema),
    variants: z.array(variantSchema),
  })
  .strict();

const targetSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/),
    architecture: z.string().min(1),
    subtarget: z.string().min(1),
    title: z.string().min(1),
    status: z.enum(["verified", "placeholder"]),
    profiles: z.array(profileSchema),
  })
  .strict();

const registrySchema = z
  .object({
    schemaVersion: z.literal(1),
    kernelLines: z.array(kernelLineSchema),
    modes: z.array(modeSchema),
    targets: z.array(targetSchema),
  })
  .strict();

export type VariantDeclaration = z.infer<typeof variantSchema>;
export type ModeOffer = z.infer<typeof modeOfferSchema>;
export type CapabilityMode = z.infer<typeof modeSchema>;
export type CapabilityKernelLine = z.infer<typeof kernelLineSchema>;
export type CapabilityProfile = z.infer<typeof profileSchema>;
export type CapabilityTarget = z.infer<typeof targetSchema>;
export type CapabilityRegistry = z.infer<typeof registrySchema>;

export type CapabilityErrorCode = "unknown-target" | "unknown-profile" | "unknown-kernel-line" | "invalid-registry";

export class CapabilityError extends Error {
  readonly code: CapabilityErrorCode;

  constructor(code: CapabilityErrorCode, message: string) {
    super(message);
    this.name = "CapabilityError";
    this.code = code;
  }
}

export type CapabilityRejectionCode =
  | "unknown-target"
  | "unknown-profile"
  | "profile-not-buildable"
  | "unknown-kernel-line"
  | "kernel-line-mismatch"
  | "kernel-line-not-offered"
  | "variant-not-declared"
  | "variant-unsupported"
  | "overlay-not-allowed"
  | "overlay-out-of-range"
  | "unknown-mode"
  | "mode-not-offered";

export interface CapabilityRejection {
  code: CapabilityRejectionCode;
  message: string;
}

export type VariantSupport =
  | { supported: true; experimental: boolean; variant: VariantDeclaration }
  | { supported: false; experimental: false; reason: CapabilityRejection };

export type ModeSupport =
  | { supported: true; experimental: boolean; mode: CapabilityMode }
  | { supported: false; experimental: false; reason: CapabilityRejection };

/** Minimal reference to a profile; a V2 `DeviceProfile` satisfies it. */
export type ProfileRef = Pick<DeviceProfile, "targetId" | "id">;

function formatIssuePath(path: ReadonlyArray<PropertyKey>): string {
  let formatted = "";
  for (const part of path) {
    if (typeof part === "number") {
      formatted += `[${part}]`;
    } else if (formatted.length === 0) {
      formatted = String(part);
    } else {
      formatted += `.${String(part)}`;
    }
  }
  return formatted.length > 0 ? formatted : "<root>";
}

/**
 * Validate a raw registry document. Returns every schema and semantic
 * violation, so CI can report them all at once instead of failing on the first.
 */
export function validateCapabilities(raw: unknown): string[] {
  const parsed = registrySchema.safeParse(raw);
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => `${formatIssuePath(issue.path)}: ${issue.message}`);
  }
  return semanticViolations(parsed.data);
}

function semanticViolations(registry: CapabilityRegistry): string[] {
  const violations: string[] = [];

  const kernelLineIds = new Set<string>();
  for (const line of registry.kernelLines) {
    if (kernelLineIds.has(line.id)) {
      violations.push(`duplicate kernel line "${line.id}"`);
    }
    kernelLineIds.add(line.id);
    if (line.id !== line.version) {
      violations.push(`kernel line "${line.id}" must use its version "${line.version}" as the id`);
    }
    if (line.engine === "source" && !line.sourceRecipeRef) {
      violations.push(`kernel line "${line.id}" uses the source engine but declares no sourceRecipeRef`);
    }
    if (line.engine === "imagebuilder" && line.sourceRecipeRef) {
      violations.push(`kernel line "${line.id}" is an ImageBuilder line and must not declare sourceRecipeRef`);
    }
  }
  if (!kernelLineIds.has("6.12")) {
    violations.push(`registry must declare the default "6.12" kernel line`);
  }

  const modeIds = new Set<string>();
  for (const mode of registry.modes) {
    if (modeIds.has(mode.id)) {
      violations.push(`duplicate mode "${mode.id}"`);
    }
    modeIds.add(mode.id);
  }

  const targetIds = new Set<string>();
  for (const target of registry.targets) {
    if (targetIds.has(target.id)) {
      violations.push(`duplicate target "${target.id}"`);
    }
    targetIds.add(target.id);

    if (target.profiles.length === 0) {
      violations.push(`target "${target.id}" has no profiles`);
      continue;
    }

    if (target.status === "placeholder") {
      for (const profile of target.profiles) {
        if (profile.status !== "placeholder") {
          violations.push(
            `target "${target.id}" is a placeholder target, so profile "${profile.id}" must be marked placeholder (got "${profile.status}")`,
          );
        }
      }
    }

    const profileIds = new Set<string>();
    for (const profile of target.profiles) {
      const label = `${target.id}:${profile.id}`;
      if (profileIds.has(profile.id)) {
        violations.push(`duplicate profile "${profile.id}" in target "${target.id}"`);
      }
      profileIds.add(profile.id);

      if (profile.variants.length === 0) {
        violations.push(`profile "${label}" declares no image variants`);
      } else if (profile.status === "verified") {
        const supported = profile.variants.some((entry) => entry.supported && !entry.experimental);
        if (!supported) {
          violations.push(`profile "${label}" claims verified status but has no supported, non-experimental image variant`);
        }
      }

      if (profile.kernelLines.length === 0) {
        violations.push(`profile "${label}" offers no kernel lines`);
      }
      for (const lineId of profile.kernelLines) {
        if (!kernelLineIds.has(lineId)) {
          violations.push(`profile "${label}" references unknown kernel line "${lineId}"`);
        }
      }

      const offeredModes = new Set<string>();
      for (const offer of profile.modes) {
        if (offeredModes.has(offer.id)) {
          violations.push(`profile "${label}" declares duplicate mode "${offer.id}"`);
        }
        offeredModes.add(offer.id);
        if (!modeIds.has(offer.id)) {
          violations.push(`profile "${label}" references unknown mode "${offer.id}"`);
        }
      }

      const { minMb, maxMb, stepMb, defaultMb } = profile.overlay;
      if (maxMb < minMb) {
        violations.push(`profile "${label}" overlay maxMb (${maxMb}) is below minMb (${minMb})`);
      }
      if (defaultMb < minMb || defaultMb > maxMb) {
        violations.push(`profile "${label}" overlay defaultMb (${defaultMb}) is outside ${minMb}..${maxMb}`);
      }
      if (stepMb > 0 && (maxMb - minMb) % stepMb !== 0) {
        violations.push(`profile "${label}" overlay range ${minMb}..${maxMb} is not a multiple of stepMb (${stepMb})`);
      }
      if (stepMb > 0 && (defaultMb - minMb) % stepMb !== 0) {
        violations.push(`profile "${label}" overlay defaultMb (${defaultMb}) is not aligned to stepMb (${stepMb})`);
      }

      const seenVariants = new Set<string>();
      for (const entry of profile.variants) {
        const key = `${entry.boot}/${entry.filesystem}/${entry.artifact}`;
        if (seenVariants.has(key)) {
          violations.push(`profile "${label}" declares duplicate variant ${key}`);
        }
        seenVariants.add(key);
      }
    }
  }

  return violations;
}

/** Parse and validate a registry document, throwing one readable error. */
export function parseCapabilities(raw: unknown): CapabilityRegistry {
  const violations = validateCapabilities(raw);
  if (violations.length > 0) {
    throw new CapabilityError(
      "invalid-registry",
      `Invalid capability registry (${violations.length} violation(s)):\n- ${violations.join("\n- ")}`,
    );
  }
  return raw as CapabilityRegistry;
}

const registryCache = new Map<string, CapabilityRegistry>();

export interface LoadCapabilitiesOptions {
  /** Override the registry file path; used by tests and alternate checkouts. */
  filePath?: string;
}

/** Load the checked-in registry, caching the parsed document per file path. */
export function loadCapabilities(options: LoadCapabilitiesOptions = {}): CapabilityRegistry {
  const filePath = capabilitiesFilePath(options.filePath);
  const cached = registryCache.get(filePath);
  if (cached) return cached;

  let rawText: string;
  try {
    rawText = readFileSync(filePath, "utf8");
  } catch (error) {
    throw new CapabilityError(
      "invalid-registry",
      `Cannot read capability registry at ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(rawText);
  } catch (error) {
    throw new CapabilityError(
      "invalid-registry",
      `Capability registry at ${filePath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const registry = parseCapabilities(raw);
  registryCache.set(filePath, registry);
  return registry;
}

export function getTarget(
  targetId: string,
  registry: CapabilityRegistry = loadCapabilities(),
): CapabilityTarget {
  const target = registry.targets.find((entry) => entry.id === targetId);
  if (!target) {
    const known = registry.targets.map((entry) => entry.id).join(", ");
    throw new CapabilityError("unknown-target", `Unknown capability target "${targetId}". Known targets: ${known}`);
  }
  return target;
}

export function getProfile(
  targetId: string,
  profileId: string,
  registry: CapabilityRegistry = loadCapabilities(),
): CapabilityProfile {
  const target = getTarget(targetId, registry);
  const profile = target.profiles.find((entry) => entry.id === profileId);
  if (!profile) {
    const known = target.profiles.map((entry) => entry.id).join(", ");
    throw new CapabilityError(
      "unknown-profile",
      `Unknown profile "${profileId}" for target "${targetId}". Known profiles: ${known}`,
    );
  }
  return profile;
}

export function getKernelLine(
  kernelLineId: string,
  registry: CapabilityRegistry = loadCapabilities(),
): CapabilityKernelLine {
  const line = registry.kernelLines.find((entry) => entry.id === kernelLineId);
  if (!line) {
    const known = registry.kernelLines.map((entry) => entry.id).join(", ");
    throw new CapabilityError(
      "unknown-kernel-line",
      `Unknown kernel line "${kernelLineId}". Known kernel lines: ${known}`,
    );
  }
  return line;
}

function reject(code: CapabilityRejectionCode, message: string): CapabilityRejection {
  return { code, message };
}

function resolveDeclaredProfile(
  profile: ProfileRef,
  registry: CapabilityRegistry,
): { target: CapabilityTarget; profile: CapabilityProfile } | CapabilityRejection {
  const target = registry.targets.find((entry) => entry.id === profile.targetId);
  if (!target) {
    const known = registry.targets.map((entry) => entry.id).join(", ");
    return reject("unknown-target", `Unknown capability target "${profile.targetId}". Known targets: ${known}`);
  }
  const declared = target.profiles.find((entry) => entry.id === profile.id);
  if (!declared) {
    const known = target.profiles.map((entry) => entry.id).join(", ");
    return reject(
      "unknown-profile",
      `Unknown profile "${profile.id}" for target "${target.id}". Known profiles: ${known}`,
    );
  }
  return { target, profile: declared };
}

function variantLabel(targetId: string, profileId: string, variant: ImageVariant): string {
  return `${variant.boot}/${variant.filesystem}/${variant.artifact} for ${targetId}:${profileId}`;
}

/**
 * Decide whether a target profile can build an image variant on a kernel line.
 *
 * This function is the single authority for tickets 03/04: callers get a typed
 * `reason` on failure instead of a bare boolean. `overlaySizeMb` is validated
 * against the profile's declared range; leaving it unset means "use the
 * profile default" and is accepted.
 */
export function supportsVariant(
  profile: ProfileRef,
  kernelLine: string | KernelLine,
  variant: ImageVariant,
  registry: CapabilityRegistry = loadCapabilities(),
): VariantSupport {
  const resolved = resolveDeclaredProfile(profile, registry);
  if ("code" in resolved) return { supported: false, experimental: false, reason: resolved };

  const { target, profile: declaredProfile } = resolved;
  if (target.status === "placeholder" || declaredProfile.status === "placeholder") {
    return {
      supported: false,
      experimental: false,
      reason: reject(
        "profile-not-buildable",
        `Profile "${target.id}:${declaredProfile.id}" is not buildable in V2.0 (placeholder target/profile).`,
      ),
    };
  }

  const kernelLineId = typeof kernelLine === "string" ? kernelLine : kernelLine.id;
  const declaredLine = registry.kernelLines.find((entry) => entry.id === kernelLineId);
  if (!declaredLine) {
    const known = registry.kernelLines.map((entry) => entry.id).join(", ");
    return {
      supported: false,
      experimental: false,
      reason: reject("unknown-kernel-line", `Unknown kernel line "${kernelLineId}". Known kernel lines: ${known}`),
    };
  }

  if (typeof kernelLine !== "string") {
    if (kernelLine.version !== declaredLine.version || kernelLine.engine !== declaredLine.engine) {
      return {
        supported: false,
        experimental: false,
        reason: reject(
          "kernel-line-mismatch",
          `Kernel line "${kernelLineId}" is declared as ${declaredLine.version}/${declaredLine.engine}, but the request used ${kernelLine.version}/${kernelLine.engine}.`,
        ),
      };
    }
  }

  if (!declaredProfile.kernelLines.includes(kernelLineId)) {
    return {
      supported: false,
      experimental: false,
      reason: reject(
        "kernel-line-not-offered",
        `Profile "${target.id}:${declaredProfile.id}" does not offer kernel line "${kernelLineId}". Offered: ${declaredProfile.kernelLines.join(", ")}.`,
      ),
    };
  }

  const label = variantLabel(target.id, declaredProfile.id, variant);
  const declaredVariant = declaredProfile.variants.find(
    (entry) =>
      entry.boot === variant.boot &&
      entry.filesystem === variant.filesystem &&
      entry.artifact === variant.artifact,
  );
  if (!declaredVariant) {
    return {
      supported: false,
      experimental: false,
      reason: reject(
        "variant-not-declared",
        `Variant ${label} is not declared by the capability registry.`,
      ),
    };
  }

  if (!declaredVariant.supported) {
    const detail = declaredVariant.notes ?? declaredVariant.verifiedBy;
    return {
      supported: false,
      experimental: false,
      reason: reject("variant-unsupported", `Variant ${label} is declared but not supported: ${detail}`),
    };
  }

  if (variant.overlaySizeMb !== undefined) {
    if (variant.artifact === "rootfs") {
      return {
        supported: false,
        experimental: false,
        reason: reject(
          "overlay-not-allowed",
          `Variant ${label} is a rootfs tarball; an overlay size does not apply to it.`,
        ),
      };
    }
    const { minMb, maxMb, stepMb } = declaredProfile.overlay;
    const size = variant.overlaySizeMb;
    if (
      !Number.isInteger(size) ||
      size < minMb ||
      size > maxMb ||
      (size - minMb) % stepMb !== 0
    ) {
      return {
        supported: false,
        experimental: false,
        reason: reject(
          "overlay-out-of-range",
          `Overlay size ${size} MB is outside the declared ${minMb}..${maxMb} MB range or not aligned to ${stepMb} MB steps for ${label}.`,
        ),
      };
    }
  }

  return {
    supported: true,
    experimental: declaredVariant.experimental || declaredLine.experimental,
    variant: declaredVariant,
  };
}

/**
 * Decide whether a profile may offer a configuration preset (mode). The
 * registry, not the request, is authoritative about experimental flags.
 */
export function supportsMode(
  profile: ProfileRef,
  modeId: string,
  registry: CapabilityRegistry = loadCapabilities(),
): ModeSupport {
  const resolved = resolveDeclaredProfile(profile, registry);
  if ("code" in resolved) return { supported: false, experimental: false, reason: resolved };

  const { target, profile: declaredProfile } = resolved;
  if (target.status === "placeholder" || declaredProfile.status === "placeholder") {
    return {
      supported: false,
      experimental: false,
      reason: reject(
        "profile-not-buildable",
        `Profile "${target.id}:${declaredProfile.id}" is not buildable in V2.0 (placeholder target/profile).`,
      ),
    };
  }

  const mode = registry.modes.find((entry) => entry.id === modeId);
  if (!mode) {
    const known = registry.modes.map((entry) => entry.id).join(", ");
    return {
      supported: false,
      experimental: false,
      reason: reject("unknown-mode", `Unknown mode "${modeId}". Known modes: ${known}`),
    };
  }

  const offer = declaredProfile.modes.find((entry) => entry.id === modeId);
  if (!offer) {
    const known = declaredProfile.modes.map((entry) => entry.id).join(", ");
    return {
      supported: false,
      experimental: false,
      reason: reject(
        "mode-not-offered",
        `Profile "${target.id}:${declaredProfile.id}" does not offer mode "${modeId}". Offered: ${known || "(none)"}.`,
      ),
    };
  }

  return { supported: true, experimental: mode.experimental || offer.experimental === true, mode };
}
