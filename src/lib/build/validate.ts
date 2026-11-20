import { z } from "zod";
import type { BuildFormInput, BuildFormInputV2, BuildVisibility } from "./types";
import type { ImageFormatId } from "../catalog/types";
import { IMAGE_FORMATS } from "../catalog/profiles";
import { BASE_PRESET_IDS, type BasePresetId, type ImageVariant } from "../domain/types";

const HOSTNAME_LABEL = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function isValidIpv4(value: string): boolean {
  const match = IPV4.exec(value);
  if (!match) return false;
  return match.slice(1).every((octet) => Number(octet) >= 0 && Number(octet) <= 255);
}

export function isContiguousNetmask(value: string): boolean {
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

export function ipv4ToInt(value: string): number {
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
  /** Negative package list: essentials are rejected at plan time, not here. */
  removePackages: z
    .array(z.string().trim().regex(PACKAGE_NAME, "package name is invalid"))
    .max(300, "too many removals")
    .optional(),
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

function isIpv4OrCidr(value: string): boolean {
  const [address, prefix, extra] = value.split("/");
  if (extra !== undefined || !isValidIpv4(address)) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,2}$/.test(prefix)) return false;
  const number = Number(prefix);
  return number >= 0 && number <= 32;
}

const NO_CONTROL = /[\u0000-\u001f\u007f]/;
const PORT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const LEASE = /^\d{1,5}[smhdw]$/;

const dhcpServerSchema = z
  .object({
    enabled: z.boolean(),
    start: z.number().int().min(1).max(254).optional(),
    limit: z.number().int().min(1).max(253).optional(),
    lease: z.string().trim().regex(LEASE, "lease must look like 12h or 1d").optional(),
  })
  .strict();

const wanNetworkSchema = z
  .object({
    protocol: z.enum(["dhcp", "static", "pppoe"]),
    device: z.string().trim().regex(PORT_ID, "wan device is invalid").optional(),
    ipv4: z.string().trim().refine(isValidIpv4, "wan ipv4 must be an IPv4 address").optional(),
    netmask: z
      .string()
      .trim()
      .refine(isContiguousNetmask, "wan netmask must be a contiguous IPv4 mask")
      .optional(),
    gateway: z.string().trim().refine(isValidIpv4, "wan gateway must be an IPv4 address").optional(),
    username: z
      .string()
      .min(1, "pppoe username is required")
      .max(128, "pppoe username is too long")
      .refine((value) => !NO_CONTROL.test(value), "pppoe username must not contain control characters")
      .optional(),
    password: z
      .string()
      .min(1, "pppoe password is required")
      .max(128, "pppoe password is too long")
      .refine((value) => !NO_CONTROL.test(value), "pppoe password must not contain control characters")
      .optional(),
    mtu: z.number().int().min(576).max(1500).optional(),
  })
  .strict();

const wifiNetworkSchema = z
  .object({
    ssid: z
      .string()
      .trim()
      .min(1, "wifi ssid is required")
      .max(32, "wifi ssid is too long")
      .refine((value) => !NO_CONTROL.test(value), "wifi ssid must not contain control characters"),
    key: z
      .string()
      .min(8, "wifi key must be at least 8 characters")
      .max(63, "wifi key is too long")
      .refine((value) => !NO_CONTROL.test(value), "wifi key must not contain control characters")
      .optional(),
    country: z.string().trim().regex(/^[A-Z]{2}$/, "wifi country must be two uppercase letters"),
    channel: z.number().int().min(1).max(233),
    band: z.enum(["2g", "5g", "6g"]),
  })
  .strict();

const switchPortSchema = z
  .object({
    wan: z.string().trim().regex(PORT_ID, "wan port is invalid"),
    lan: z
      .array(z.string().trim().regex(PORT_ID, "lan port is invalid"))
      .min(1, "at least one lan port is required")
      .max(32),
  })
  .strict();

const bypassSchema = z
  .object({
    gateway: z.string().trim().refine(isValidIpv4, "bypass gateway must be an IPv4 address").optional(),
    dns: z.array(z.string().trim().refine(isValidIpv4, "bypass dns must be an IPv4 address")).max(4).optional(),
    sourceIps: z
      .array(z.string().trim().refine(isIpv4OrCidr, "bypass source must be an IPv4 address or CIDR"))
      .max(16)
      .optional(),
  })
  .strict();

/**
 * Typed network overrides. Strict objects everywhere: an unknown key would be
 * a free-form escape hatch (writes routes to mode declarations), so it is a
 * validation error instead.
 */
export const networkInputSchema = z
  .object({
    lan: z.object({ dhcp: dhcpServerSchema.optional() }).strict().optional(),
    wan: wanNetworkSchema.optional(),
    dns: z
      .array(z.string().trim().refine(isValidIpv4, "dns must be an IPv4 address"))
      .max(4, "too many dns servers")
      .optional(),
    ipv6: z.enum(["disabled", "dhcpv6", "ra", "relay"]).optional(),
    wifi: wifiNetworkSchema.optional(),
    switchPort: switchPortSchema.optional(),
    bypass: bypassSchema.optional(),
  })
  .strict();

const schemaV2 = z.object({
  profile: z.string().trim().min(1, "profile is required"),
  target: z.string().trim().min(1, "target is required"),
  kernelLine: z.string().trim().min(1, "kernelLine is required"),
  baseVersion: z.string().trim().regex(/^\d+\.\d+\.\d+$/, "baseVersion is invalid").optional(),
  imageVariant: variantSchema,
  basePreset: z.enum(BASE_PRESETS).optional(),
  modes: z.array(modeRefSchema).max(50, "too many modes").optional(),
  network: networkInputSchema.optional(),
  ...configFields,
});

export type ValidationResult =
  | { ok: true; value: BuildFormInput & { imageType: ImageFormatId } }
  | { ok: false; issues: string[] };

export type ValidationResultV2 =
  | {
      ok: true;
      value: BuildFormInputV2 & {
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
  const removePackages = parsed.data.removePackages
    ? [...new Set(parsed.data.removePackages.map((name) => name.trim()).filter(Boolean))]
    : undefined;
  return {
    ok: true,
    value: {
      ...parsed.data,
      packages,
      ...(removePackages ? { removePackages } : {}),
      visibility: parsed.data.visibility ?? "private",
    },
  };
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
  const removePackages = parsed.data.removePackages
    ? [...new Set(parsed.data.removePackages.map((name) => name.trim()).filter(Boolean))]
    : undefined;
  const imageVariant = parsed.data.imageVariant as ImageVariant;
  return {
    ok: true,
    value: {
      ...parsed.data,
      imageVariant,
      packages,
      ...(removePackages ? { removePackages } : {}),
      visibility: parsed.data.visibility ?? "private",
      modes: parsed.data.modes ?? [],
    },
  };
}

/**
 * A request is V2 only when it explicitly says so. The V2 form sends
 * `schemaVersion: 2` plus the target id; the V1 form sends neither, so the V1
 * route path stays byte-identical. Inferring V2 from a stray `imageVariant` or
 * `kernelLine` field let a malformed V1 request take the V2 path with no target.
 */
export function isBuildPlanV2Form(input: unknown): boolean {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
  const value = input as Record<string, unknown>;
  return (
    value.schemaVersion === 2 &&
    typeof value.target === "string" &&
    value.target.trim().length > 0
  );
}
