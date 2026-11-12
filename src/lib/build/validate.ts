import { z } from "zod";
import type { BuildFormInput } from "./types";
import type { ImageFormatId } from "../catalog/types";
import { IMAGE_FORMATS } from "../catalog/profiles";

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

const schema = z.object({
  profile: z.string().trim().min(1, "profile is required"),
  imageType: z.enum(IMAGE_TYPE_IDS),
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
});

export type ValidationResult =
  | { ok: true; value: BuildFormInput & { imageType: ImageFormatId } }
  | { ok: false; issues: string[] };

export function validateBuildForm(input: unknown): ValidationResult {
  const parsed = schema.safeParse(input);
  const issues = parsed.success
    ? []
    : parsed.error.issues.map((issue) => `${issue.path.join(".") || "form"}: ${issue.message}`);

  if (parsed.success && !isUsableLan(parsed.data.lanIp, parsed.data.netmask)) {
    issues.push("lanIp: must be a usable host address inside the LAN subnet");
  }
  if (issues.length > 0 || !parsed.success) {
    return { ok: false, issues };
  }

  const packages = [...new Set(parsed.data.packages.map((name) => name.trim()).filter(Boolean))];
  return { ok: true, value: { ...parsed.data, packages } };
}
