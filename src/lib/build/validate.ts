import { z } from "zod";
import type { BuildFormInput, BuildFormInputV2, BuildVisibility } from "./types";
import type { ImageFormatId } from "../catalog/types";
import { IMAGE_FORMATS } from "../catalog/profiles";
import { BASE_PRESET_IDS, type BasePresetId, type ImageVariant } from "../domain/types";
import { imageTypeForVariant } from "./artifact-name";

const HOSTNAME_LABEL = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function isValidIpv4(value: string): boolean {
  const match = IPV4.exec(value);
  if (!match) return false;
  return match.slice(1).every((octet) => Number(octet) >= 0 && Number(octet) <= 255);
}

function isContiguousNetmask(value: string): boolean {
  if (!isValidIpv4(value)) return false;
  const [a, b, c, d] = value.split(".").map(Number);
  const mask = ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
  const inverted = (~mask >>> 0) + 1;
  return mask !== 0 && (inverted & (inverted - 1)) === 0;
}

const TIMEZONES = new Set<string>(["UTC", ...Intl.supportedValuesOf("timeZone")]);
const IMAGE_TYPE_IDS = IMAGE_FORMATS.map((format) => format.id) as [ImageFormatId, ...ImageFormatId[]];
const BASE_PRESETS = BASE_PRESET_IDS as [BasePresetId, ...BasePresetId[]];
const PACKAGE_NAME = /^(?:(?:official|dllkids|supplement)\/)?[A-Za-z0-9][A-Za-z0-9+._-]*(?:@[A-Za-z0-9+._~-]+)?$/;

function ipv4ToInt(value: string): number {
  return value.split(".").reduce((result, octet) => (result << 8) + Number(octet), 0) >>> 0;
}

function isUsableLan(lanIp: string, netmask: string): boolean {
  const mask = ipv4ToInt(netmask);
  const prefix = mask.toString(2).split("1").length - 1;
  if (prefix < 8 || prefix > 30) return false;
  const ip = ipv4ToInt(lanIp);
  const network = (ip & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  return ip !== network && ip !== broadcast;
}

/** Fields shared by the V1 and V2 forms. */
const configFields = {
  hostname: z
    .string()
    .trim()
    .min(1, "hostname is required")
    .max(253, "hostname is too long")
    .refine((value) => value.split(".").every((label) => HOSTNAME_LABEL.test(label)), "hostname is invalid"),
  timezone: z.string().refine((value) => TIMEZONES.has(value), "timezone is invalid"),
  lanIp: z.string().refine(isValidIpv4, "lanIp must be an IPv4 address"),
  netmask: z.string().refine(isContiguousNetmask, "netmask must be a contiguous IPv4 mask"),
  rootPassword: z
    .string()
    .min(8, "rootPassword must be at least 8 characters")
    .max(128, "rootPassword is too long")
    .refine((value) => !/[\r\n]/.test(value), "rootPassword must not contain line breaks"),
  packages: z
    .array(z.string().trim().regex(PACKAGE_NAME, "package name is invalid"))
    .max(300, "too many packages"),
  visibility: z.enum(["private", "public"]).optional(),
  packagePins: z
    .array(
      z.object({
        name: z.string().trim().regex(PACKAGE_NAME, "package pin name is invalid"),
        source: z.enum(["official", "dllkids", "supplement"]).optional(),
        version: z.string().trim().min(1).max(128).optional(),
        sha256: z.string().trim().regex(/^[0-9a-f]{64}$/, "package pin sha256 is invalid").optional(),
      }),
    )
    .max(300)
    .optional(),
};

const schema = z.object({
  profile: z.string().trim().min(1, "profile is required"),
  imageType: z.enum(IMAGE_TYPE_IDS),
  ...configFields,
});

const variantSchema = z.object({
  boot: z.enum(["efi", "legacy"]),
  filesystem: z.enum(["ext4", "squashfs"]),
  artifact: z.enum(["combined", "rootfs", "vmdk", "qcow2", "emmc"]),
  /** Bounds are the capability registry's job; the form only checks the shape. */
  overlaySizeMb: z.number().int().min(0).optional(),
});

const modeRefSchema = z.object({
  id: z.string().trim().min(1, "mode id is required"),
  layer: z.enum(["file/board", "package/kernel", "kernel/config"]),
  title: z.string().trim().min(1).optional(),
});

const schemaV2 = z.object({
  profile: z.string().trim().min(1, "profile is required"),
  target: z.string().trim().min(1, "target is required"),
  kernelLine: z.string().trim().min(1, "kernelLine is required"),
  imageVariant: variantSchema,
  basePreset: z.enum(BASE_PRESETS).optional(),
  modes: z.array(modeRefSchema).max(50, "too many modes").optional(),
  ...configFields,
});

export type ValidationResult =
  | { ok: true; value: BuildFormInput & { imageType: ImageFormatId } }
  | { ok: false; issues: string[] };

export type ValidationResultV2 =
  | {
      ok: true;
      value: BuildFormInputV2 & {
        imageType: ImageFormatId;
        imageVariant: ImageVariant;
        visibility: BuildVisibility;
      };
    }
  | { ok: false; issues: string[] };

function zodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join(".") || "form"}: ${issue.message}`);
}

export function validateBuildForm(input: unknown): ValidationResult {
  const parsed = schema.safeParse(input);
  const issues = parsed.success ? [] : zodIssues(parsed.error);

  if (parsed.success && !isUsableLan(parsed.data.lanIp, parsed.data.netmask)) {
    issues.push("lanIp: must be a usable host address inside the LAN subnet");
  }
  if (issues.length > 0 || !parsed.success) {
    return { ok: false, issues };
  }

  const packages = [...new Set(parsed.data.packages.map((name) => name.trim()).filter(Boolean))];
  return { ok: true, value: { ...parsed.data, packages, visibility: parsed.data.visibility ?? "private" } };
}

export function validateBuildFormV2(input: unknown): ValidationResultV2 {
  const parsed = schemaV2.safeParse(input);
  const issues = parsed.success ? [] : zodIssues(parsed.error);

  if (parsed.success && !isUsableLan(parsed.data.lanIp, parsed.data.netmask)) {
    issues.push("lanIp: must be a usable host address inside the LAN subnet");
  }
  if (issues.length > 0 || !parsed.success) {
    return { ok: false, issues };
  }

  const packages = [...new Set(parsed.data.packages.map((name) => name.trim()).filter(Boolean))];
  const imageVariant = parsed.data.imageVariant as ImageVariant;
  return {
    ok: true,
    value: {
      ...parsed.data,
      imageVariant,
      imageType: imageTypeForVariant(imageVariant),
      packages,
      visibility: parsed.data.visibility ?? "private",
      modes: parsed.data.modes ?? [],
    },
  };
}

/**
 * A request is V2 as soon as it names the V2 triple. The V1 form never sends
 * these fields, so the V1 route path stays byte-identical.
 */
export function isBuildPlanV2Form(input: unknown): boolean {
  if (typeof input !== "object" || input === null) return false;
  const value = input as Record<string, unknown>;
  return (
    value.schemaVersion === 2 ||
    value.imageVariant !== undefined ||
    value.kernelLine !== undefined
  );
}
