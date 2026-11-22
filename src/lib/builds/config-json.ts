import { BUILD_CONFIG_FORMAT } from "@/app/build/form-model";

/**
 * Read helpers for `builds.config_json`.
 *
 * A V2 row stores the portable `combinewrt-build` document (see
 * `exportBuildConfig`); older rows may hold a V1/V2 bare config object. Pages can
 * therefore not assume one shape, and go through these narrow readers instead.
 */
export interface StoredConfigFields {
  hostname: string;
  timezone: string;
  lanIp: string;
  netmask: string;
  timezoneKnown: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isPortableConfig(value: unknown): boolean {
  return isRecord(value) && value.format === BUILD_CONFIG_FORMAT && isRecord(value.config);
}

/** The form-state object inside a portable config, or null for legacy rows. */
export function portableConfig(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value) || value.format !== BUILD_CONFIG_FORMAT || !isRecord(value.config)) return null;
  return value.config;
}

function text(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  return typeof field === "string" ? field : "";
}

/** Hostname/timezone/LAN fields from either shape, or null when the row has no config. */
export function storedConfigFields(config: unknown): StoredConfigFields | null {
  const portable = portableConfig(config);
  const source = portable ?? (isRecord(config) ? config : null);
  if (!source) return null;
  const hostname = text(source, "hostname");
  const timezone = text(source, "timezone");
  const lanIp = text(source, "lanIp") || text(source, "ip");
  const netmask = text(source, "netmask");
  return {
    hostname,
    timezone,
    lanIp,
    netmask,
    timezoneKnown: timezone.length > 0,
  };
}
