import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { BasePresetId, BuildEngine, ImageVariant, ModeLayer, ModeRef } from "../domain/types";
import type {
  AppliedMode,
  BuildConflict,
  GeneratedFile,
  ModeSecretSpec,
  ModeState,
  NetworkConfig,
  NetworkInput,
  WanNetworkConfig,
  WifiBand,
  WifiNetworkConfig,
} from "./types";
import { shellQuote } from "./uci";
import { ipv4ToInt, isContiguousNetmask, isValidIpv4 } from "./validate";

/**
 * Declarative mode system (ticket 07, ADR 0006).
 *
 * A mode is data only: a typed network patch, a small, whitelisted set of
 * generated files and requirement/conflict declarations. There is deliberately
 * no way to express a shell command, an arbitrary UCI line or an upload path
 * from a mode config: everything a mode can do is one of the typed fields
 * below, and every generated path must be in `MODE_FILE_WHITELIST`.
 */

export const MODE_UCI_PATH = "/etc/uci-defaults/90-combinewrt-modes";
/** Docker mode: only creates the data root; it never pulls or runs images. */
export const DOCKER_UCI_PATH = "/etc/uci-defaults/91-combinewrt-docker";
export const OPENWRT_RELEASE_PATH = "/etc/openwrt_release";
export const SAMBA4_CONFIG_PATH = "/etc/config/samba4";
export const HTTPS_CERT_PATH = "/etc/uhttpd.crt";
export const HTTPS_KEY_PATH = "/etc/uhttpd.key";

/** The complete set of image paths any mode may write. */
export const MODE_FILE_WHITELIST = [
  MODE_UCI_PATH,
  DOCKER_UCI_PATH,
  OPENWRT_RELEASE_PATH,
  SAMBA4_CONFIG_PATH,
] as const;

export type ModeGeneratedPath = (typeof MODE_FILE_WHITELIST)[number];

/** Plan paths add the `files/` overlay prefix expected by the ImageBuilder/source build. */
export function modePlanPath(imagePath: ModeGeneratedPath): string {
  return `files${imagePath}`;
}

const REQUIREMENT_TOKEN =
  /^(?:mode|capability|engine|filesystem|artifact|feature|package):[a-z0-9][a-z0-9+._/-]{0,63}$/;

const requirementToken = z
  .string()
  .trim()
  .regex(REQUIREMENT_TOKEN, "requirement token is invalid");

const dhcpPatchSchema = z
  .object({
    enabled: z.boolean().optional(),
    start: z.number().int().min(1).max(254).optional(),
    limit: z.number().int().min(1).max(253).optional(),
    lease: z.string().trim().regex(/^\d{1,5}[smhdw]$/).optional(),
  })
  .strict();

const wanPatchSchema = z
  .object({
    protocol: z.enum(["dhcp", "static", "pppoe"]).optional(),
    device: z.string().trim().min(1).max(32).optional(),
    ipv4: z.string().trim().optional(),
    netmask: z.string().trim().optional(),
    gateway: z.string().trim().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
    mtu: z.number().int().min(576).max(1500).optional(),
  })
  .strict();

const wifiPatchSchema = z
  .object({
    ssid: z.string().trim().min(1).max(32),
    key: z.string().optional(),
    country: z.string().trim().length(2),
    channel: z.number().int().min(1).max(233),
    band: z.enum(["2g", "5g", "6g"]),
  })
  .strict();

const switchPortPatchSchema = z
  .object({
    wan: z.string().trim().min(1).max(32),
    lan: z.array(z.string().trim().min(1).max(32)).min(1).max(32),
  })
  .strict();

const bypassPatchSchema = z
  .object({
    gateway: z.string().trim().optional(),
    dns: z.array(z.string().trim()).max(4).optional(),
    sourceIps: z.array(z.string().trim()).max(16).optional(),
  })
  .strict();

const networkPatchSchema = z
  .object({
    lan: z
      .object({
        ipv4: z.string().trim().optional(),
        netmask: z.string().trim().optional(),
        dhcp: dhcpPatchSchema.optional(),
      })
      .strict()
      .optional(),
    wan: wanPatchSchema.optional(),
    dns: z.array(z.string().trim()).max(4).optional(),
    ipv6: z.enum(["disabled", "dhcpv6", "ra", "relay"]).optional(),
    wifi: wifiPatchSchema.nullable().optional(),
    switchPort: switchPortPatchSchema.nullable().optional(),
    bypass: bypassPatchSchema.nullable().optional(),
  })
  .strict();

export type ModeNetworkPatch = z.infer<typeof networkPatchSchema>;

/**
 * One `config/modes/*.json` file. The schema is strict: an unknown key is a
 * config error, not a silently ignored extension point.
 */
const modeDeclarationBase = z
  .object({
    id: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "mode id is invalid"),
    layer: z.enum(["file/board", "package/kernel", "kernel/config"]),
    title: z.string().trim().min(1).max(120),
    experimental: z.boolean(),
    description: z.string().trim().min(1).max(500).optional(),
    /** Two modes with the same group cannot be selected together. */
    exclusiveGroup: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9-]{0,31}$/)
      .optional(),
    requires: z.array(requirementToken).max(16).optional(),
    /** Each inner array is an OR group: at least one token must hold. */
    requiresAny: z.array(z.array(requirementToken).min(1).max(8)).max(8).optional(),
    conflicts: z.array(requirementToken).max(16).optional(),
    /**
     * Package set of a package/kernel mode (ticket 08). Names are plain
     * package names: the mode never picks a source, the package source
     * registry does. kmod packages must resolve to the official source.
     */
    packages: z
      .array(z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9+._-]*$/, "package name is invalid"))
      .max(100)
      .optional(),
    /** Kernel config fragment of a kernel/config mode (ticket 08); source builds only. */
    kernelConfig: z
      .array(z.string().trim().regex(/^CONFIG_[A-Z0-9_]+=(y|m)$/, "kernel config line is invalid"))
      .max(200)
      .optional(),
    /** Docker data root the mode makes writable (ticket 08). */
    docker: z
      .object({ dataRoot: z.string().trim().regex(/^\/[A-Za-z0-9._/-]+$/) })
      .strict()
      .optional(),
    generatedFiles: z.array(z.enum(MODE_FILE_WHITELIST)).max(8).optional(),
    network: networkPatchSchema.optional(),
    branding: z
      .object({
        distribId: z.string().trim().min(1).max(32),
        description: z.string().trim().min(1).max(120).optional(),
      })
      .strict()
      .optional(),
    nas: z
      .object({
        shareName: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/),
        path: z.string().trim().startsWith("/"),
        readOnly: z.boolean().optional(),
        guestOk: z.boolean().optional(),
      })
      .strict()
      .optional(),
    secret: z
      .object({
        kind: z.literal("https-selfsigned"),
        certPath: z.literal(HTTPS_CERT_PATH),
        keyPath: z.literal(HTTPS_KEY_PATH),
      })
      .strict()
      .optional(),
  })
  .strict();

/**
 * Layer rules ride on the same schema (rather than a looser one): a kernel
 * fragment is only meaningful for a kernel/config mode, and a package set is
 * not a file/board change.
 */
export const modeDeclarationSchema = modeDeclarationBase.superRefine((declaration, ctx) => {
  const add = (path: string, message: string) => {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
  };

  if (declaration.kernelConfig && declaration.kernelConfig.length > 0) {
    if (declaration.layer !== "kernel/config") {
      add("kernelConfig", "kernelConfig is only allowed on the kernel/config layer");
    }
    if (new Set(declaration.kernelConfig).size !== declaration.kernelConfig.length) {
      add("kernelConfig", "kernelConfig lines must be unique");
    }
  }
  if (declaration.docker && declaration.layer !== "kernel/config") {
    add("docker", "docker is only allowed on the kernel/config layer");
  }
  if (declaration.packages && new Set(declaration.packages).size !== declaration.packages.length) {
    add("packages", "package names must be unique");
  }
});

export type ModeDeclaration = z.infer<typeof modeDeclarationSchema>;

export class ModeConfigError extends Error {}

interface BasePresetDefinition {
  id: BasePresetId;
  title: string;
  experimental: boolean;
  /** Tokens this preset satisfies for requirement/conflict resolution. */
  features: string[];
  patch?: ModeNetworkPatch;
}

/**
 * Base presets are part of the planner, not files: they are few, they carry the
 * stock network shape, and ticket 08 fills their package sets. `router-default`
 * is the preset that maps WAN to the default device and runs a DHCP server, so
 * it is what `wan-eth0` and `bypass` conflict with.
 */
const BASE_PRESETS: Record<BasePresetId, BasePresetDefinition> = {
  minimal: {
    id: "minimal",
    title: "Minimal",
    experimental: false,
    features: [],
  },
  common: {
    id: "common",
    title: "Common",
    experimental: false,
    features: [],
  },
  "router-default": {
    id: "router-default",
    title: "Router default",
    experimental: false,
    features: ["feature:default-wan", "feature:dhcp-server"],
    patch: {
      wan: { protocol: "dhcp", device: "default" },
      lan: { dhcp: { enabled: true } },
    },
  },
};

const declarationCache = new Map<string, readonly ModeDeclaration[]>();

function modeConfigDirectory(options: { directory?: string }): string {
  return resolve(options.directory ?? join(process.cwd(), "config", "modes"));
}

/** Load and validate every `config/modes/*.json`; cached per directory. */
export function loadModeDeclarations(options: { directory?: string } = {}): readonly ModeDeclaration[] {
  const directory = modeConfigDirectory(options);
  const cached = declarationCache.get(directory);
  if (cached) return cached;

  let files: string[];
  try {
    files = readdirSync(directory)
      .filter((file) => file.endsWith(".json"))
      .sort();
  } catch {
    throw new ModeConfigError(`mode config directory is missing: ${directory}`);
  }

  const declarations: ModeDeclaration[] = [];
  const seen = new Map<string, string>();
  for (const file of files) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(join(directory, file), "utf8"));
    } catch (error) {
      throw new ModeConfigError(
        `mode config ${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const parsed = modeDeclarationSchema.safeParse(raw);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "mode"}: ${issue.message}`)
        .join("; ");
      throw new ModeConfigError(`mode config ${file} is invalid: ${detail}`);
    }
    const declaration = parsed.data;
    const previous = seen.get(declaration.id);
    if (previous) {
      throw new ModeConfigError(
        `mode "${declaration.id}" is declared twice (${previous} and ${file})`,
      );
    }
    seen.set(declaration.id, file);
    declarations.push(declaration);
  }

  declarationCache.set(directory, declarations);
  return declarations;
}

export interface ModeRegistryEntry {
  id: string;
  layer: ModeLayer;
  title: string;
  experimental: boolean;
  requiresEngine?: BuildEngine;
}

/**
 * Keep `config/modes/*.json` and `config/capabilities/targets.json` honest:
 * same ids, same layer, same experimental flag, and a mode that the capability
 * registry gates to an engine must declare that requirement too. Returns
 * human-readable issues (empty means the two registries agree).
 */
export function validateModeDeclarations(
  declarations: readonly ModeDeclaration[],
  registryModes: readonly ModeRegistryEntry[],
): string[] {
  const issues: string[] = [];
  const byId = new Map(declarations.map((declaration) => [declaration.id, declaration]));

  for (const mode of registryModes) {
    const declaration = byId.get(mode.id);
    if (!declaration) {
      issues.push(
        `mode "${mode.id}" is declared in the capability registry but has no config/modes entry`,
      );
      continue;
    }
    byId.delete(mode.id);
    if (declaration.layer !== mode.layer) {
      issues.push(
        `mode "${mode.id}" layer "${declaration.layer}" does not match the capability registry layer "${mode.layer}"`,
      );
    }
    if (declaration.experimental !== mode.experimental) {
      issues.push(
        `mode "${mode.id}" experimental=${declaration.experimental} does not match the capability registry experimental=${mode.experimental}`,
      );
    }
    if (mode.requiresEngine && !(declaration.requires ?? []).includes(`engine:${mode.requiresEngine}`)) {
      issues.push(
        `mode "${mode.id}" requires the "${mode.requiresEngine}" engine in the capability registry but does not declare requires ["engine:${mode.requiresEngine}"]`,
      );
    }
  }

  for (const id of byId.keys()) {
    issues.push(`mode "${id}" has a config/modes entry but is not declared in the capability registry`);
  }

  return issues;
}

export interface ModeResolutionInput {
  basePreset?: BasePresetId;
  overlays: readonly ModeRef[];
  network?: NetworkInput;
  hostname: string;
  baseVersion: string;
  feedCommit: string;
  targetId: string;
  architecture: string;
  imageVariant: ImageVariant;
  engine: BuildEngine;
  capabilities: readonly string[];
  /** Top-level package selection, used for `package:` conflict tokens. */
  packages?: readonly string[];
  lanIp: string;
  netmask: string;
}

export interface ModeResolution {
  state: ModeState;
  files: GeneratedFile[];
  conflicts: BuildConflict[];
  issues: string[];
  /** Deduplicated package set of the selected package/kernel modes. */
  packages: string[];
  /** Which mode owns each package (removal protection names the mode). */
  packageOwners: Array<{ name: string; mode: string }>;
  /** Deduplicated kernel config fragment of the selected kernel/config modes. */
  kernelConfig: string[];
  /** Set when a selected mode declares a Docker data root. */
  docker?: { dataRoot: string };
}

export interface ResolveModesOptions {
  declarations?: readonly ModeDeclaration[];
  directory?: string;
}

/** Modes that change the generated network file. */
const NETWORK_MODE_IDS = new Set(["wan-eth0", "switch-port", "ipv6", "pppoe", "wifi", "bypass"]);

function defaultNetwork(input: ModeResolutionInput): NetworkConfig {
  return {
    lan: {
      ipv4: input.lanIp,
      netmask: input.netmask,
      dhcp: { enabled: true, start: 100, limit: 150, lease: "12h" },
    },
    wan: { protocol: "dhcp", device: "default" },
    dns: [],
    ipv6: "disabled",
    wifi: null,
    switchPort: null,
    bypass: null,
  };
}

function mergePatch(network: NetworkConfig, patch: ModeNetworkPatch | undefined): NetworkConfig {
  if (!patch) return network;
  return {
    lan: {
      ...network.lan,
      ...(patch.lan?.ipv4 !== undefined ? { ipv4: patch.lan.ipv4 } : {}),
      ...(patch.lan?.netmask !== undefined ? { netmask: patch.lan.netmask } : {}),
      dhcp: { ...network.lan.dhcp, ...patch.lan?.dhcp },
    },
    wan: patch.wan ? { ...network.wan, ...patch.wan } : network.wan,
    dns: patch.dns ? [...patch.dns] : network.dns,
    ipv6: patch.ipv6 ?? network.ipv6,
    wifi: patch.wifi !== undefined ? patch.wifi : network.wifi,
    switchPort: patch.switchPort !== undefined ? patch.switchPort : network.switchPort,
    bypass: patch.bypass !== undefined ? patch.bypass : network.bypass,
  };
}

function applyNetworkInput(network: NetworkConfig, input: NetworkInput | undefined): NetworkConfig {
  if (!input) return network;
  return {
    lan: {
      ...network.lan,
      dhcp: { ...network.lan.dhcp, ...input.lan?.dhcp },
    },
    wan: input.wan ? { ...network.wan, ...input.wan } : network.wan,
    dns: input.dns ? [...input.dns] : network.dns,
    ipv6: input.ipv6 ?? network.ipv6,
    wifi: input.wifi ? { ...input.wifi } : network.wifi,
    switchPort: input.switchPort
      ? { wan: input.switchPort.wan, lan: [...input.switchPort.lan] }
      : network.switchPort,
    bypass: input.bypass
      ? {
          ...input.bypass,
          ...(input.bypass.dns ? { dns: [...input.bypass.dns] } : {}),
          ...(input.bypass.sourceIps ? { sourceIps: [...input.bypass.sourceIps] } : {}),
        }
      : network.bypass,
  };
}

function describeToken(token: string): string {
  const separator = token.indexOf(":");
  const kind = token.slice(0, separator);
  const value = token.slice(separator + 1);
  switch (kind) {
    case "mode":
      return `mode "${value}"`;
    case "capability":
      return `a target with the "${value}" capability`;
    case "engine":
      return `the ${value} engine`;
    case "filesystem":
    case "artifact":
      return `a ${value} image`;
    case "feature":
      if (value === "default-wan") return "the default WAN mapping";
      if (value === "dhcp-server") return "a DHCP server";
      return `feature "${value}"`;
    default:
      return token;
  }
}

function applied(declaration: ModeDeclaration): AppliedMode {
  return {
    id: declaration.id,
    layer: declaration.layer,
    title: declaration.title,
    experimental: declaration.experimental,
  };
}

function prefixLength(netmask: string): number {
  return ipv4ToInt(netmask).toString(2).split("1").length - 1;
}

function validateStaticWan(wan: WanNetworkConfig, issues: string[]): void {
  if (!wan.ipv4) issues.push("network.wan.ipv4: a static WAN requires an IPv4 address.");
  if (!wan.netmask) issues.push("network.wan.netmask: a static WAN requires a netmask.");
  if (!wan.gateway) issues.push("network.wan.gateway: a static WAN requires a gateway.");
  if (!wan.ipv4 || !wan.netmask || !wan.gateway) return;
  if (!isValidIpv4(wan.ipv4) || !isValidIpv4(wan.gateway) || !isContiguousNetmask(wan.netmask)) {
    return; // shape errors are reported by the form schema
  }

  const mask = ipv4ToInt(wan.netmask);
  const prefix = prefixLength(wan.netmask);
  if (prefix < 8 || prefix > 30) {
    issues.push("network.wan.netmask: the WAN prefix must be between /8 and /30.");
    return;
  }
  const address = ipv4ToInt(wan.ipv4);
  const gateway = ipv4ToInt(wan.gateway);
  const networkAddress = (address & mask) >>> 0;
  const broadcast = (networkAddress | (~mask >>> 0)) >>> 0;
  if (address === networkAddress || address === broadcast) {
    issues.push("network.wan.ipv4: the WAN address must be a usable host address.");
  }
  if (((gateway & mask) >>> 0) !== networkAddress) {
    issues.push("network.wan.gateway: the WAN gateway is outside the WAN subnet.");
  }
  if (gateway === address) {
    issues.push("network.wan.gateway: the WAN gateway must differ from the WAN address.");
  }
}

function validateWifi(wifi: WifiNetworkConfig, issues: string[]): void {
  const ranges: Record<WifiBand, [number, number]> = {
    "2g": [1, 14],
    "5g": [32, 196],
    "6g": [1, 233],
  };
  const [min, max] = ranges[wifi.band];
  if (wifi.channel < min || wifi.channel > max) {
    issues.push(`network.wifi.channel: channel ${wifi.channel} is not valid for the ${wifi.band} band (${min}..${max}).`);
  }
}

function validateNetwork(
  network: NetworkConfig,
  selected: ReadonlySet<string>,
  issues: string[],
  conflicts: BuildConflict[],
): void {
  // LAN DHCP server.
  const dhcp = network.lan.dhcp;
  if (dhcp.enabled) {
    const start = dhcp.start ?? 100;
    const limit = dhcp.limit ?? 150;
    if (start + limit - 1 > 254) {
      issues.push("network.lan.dhcp: the address pool runs past .254; lower start or limit.");
    }
    if (dhcp.lease !== undefined && !/^\d{1,5}[smhdw]$/.test(dhcp.lease)) {
      issues.push("network.lan.dhcp.lease: lease must look like 12h or 1d.");
    }
  }
  if (dhcp.enabled && selected.has("bypass")) {
    conflicts.push({
      names: ["bypass"],
      message:
        'Mode "bypass" conflicts with a DHCP server: disable network.lan.dhcp before selecting it.',
    });
  }

  // WAN protocol and its typed fields.
  const wan = network.wan;
  const pppoeSelected = selected.has("pppoe");
  if (wan.protocol === "pppoe") {
    if (!pppoeSelected) {
      issues.push('network.wan.protocol "pppoe" requires the "pppoe" mode.');
    }
    if (!wan.username) issues.push("network.wan.username: PPPoE requires a username.");
    if (!wan.password) issues.push("network.wan.password: PPPoE requires a password.");
  } else if (pppoeSelected) {
    issues.push(
      `Mode "pppoe" is selected but network.wan.protocol is "${wan.protocol}" instead of "pppoe".`,
    );
  }
  if (wan.protocol === "static") {
    validateStaticWan(wan, issues);
  } else if (wan.ipv4 || wan.netmask || wan.gateway) {
    issues.push(`WAN address fields require network.wan.protocol "static", not "${wan.protocol}".`);
  }
  if (wan.protocol !== "pppoe" && (wan.username || wan.password || wan.mtu !== undefined)) {
    issues.push('PPPoE fields (username/password/mtu) require network.wan.protocol "pppoe".');
  }

  // wan-eth0 locks the WAN device.
  if (selected.has("wan-eth0") && wan.device !== "eth0") {
    issues.push('Mode "wan-eth0" requires network.wan.device "eth0".');
  }

  // Switch-port mode needs the explicit port map.
  const switchSelected = selected.has("switch-port");
  if (switchSelected && !network.switchPort) {
    issues.push(
      'Mode "switch-port" requires network.switchPort with a WAN port and at least one LAN port.',
    );
  }
  if (!switchSelected && network.switchPort) {
    issues.push('network.switchPort requires the "switch-port" mode.');
  }
  if (network.switchPort) {
    const { wan: wanPort, lan } = network.switchPort;
    if (lan.includes(wanPort)) {
      issues.push("network.switchPort: the WAN port cannot also be a LAN port.");
    }
    if (new Set(lan).size !== lan.length) {
      issues.push("network.switchPort: LAN ports must be unique.");
    }
  }

  // IPv6 is a mode, not a free-form table.
  const ipv6Selected = selected.has("ipv6");
  if (ipv6Selected && network.ipv6 === "disabled") {
    issues.push('Mode "ipv6" is selected but network.ipv6 is "disabled".');
  }
  if (!ipv6Selected && network.ipv6 !== "disabled") {
    issues.push("network.ipv6 requires the \"ipv6\" mode.");
  }

  // WiFi is typed and capability-gated.
  const wifiSelected = selected.has("wifi");
  if (wifiSelected && !network.wifi) {
    issues.push(
      'Mode "wifi" requires network.wifi (ssid, country, channel and band).',
    );
  }
  if (!wifiSelected && network.wifi) {
    issues.push('network.wifi requires the "wifi" mode.');
  }
  if (network.wifi && wifiSelected) validateWifi(network.wifi, issues);

  // Bypass is optional configuration for the mode.
  if (!selected.has("bypass") && network.bypass) {
    issues.push('network.bypass requires the "bypass" mode.');
  }

}

function generateModeUci(
  network: NetworkConfig,
  selected: ReadonlySet<string>,
): string {
  const lines: string[] = ["#!/bin/sh", "set -e", ""];
  const commits = new Set<string>(["network"]);

  lines.push(`uci set network.lan.ipaddr=${shellQuote(network.lan.ipv4)}`);
  lines.push(`uci set network.lan.netmask=${shellQuote(network.lan.netmask)}`);

  if (network.lan.dhcp.enabled) {
    lines.push("uci set dhcp.lan.ignore='0'");
    lines.push(`uci set dhcp.lan.start=${shellQuote(String(network.lan.dhcp.start ?? 100))}`);
    lines.push(`uci set dhcp.lan.limit=${shellQuote(String(network.lan.dhcp.limit ?? 150))}`);
    lines.push(`uci set dhcp.lan.leasetime=${shellQuote(network.lan.dhcp.lease ?? "12h")}`);
  } else {
    lines.push("uci set dhcp.lan.ignore='1'");
  }
  commits.add("dhcp");

  lines.push(`uci set network.wan.proto=${shellQuote(network.wan.protocol)}`);
  if (network.wan.device && network.wan.device !== "default") {
    lines.push(`uci set network.wan.device=${shellQuote(network.wan.device)}`);
  }
  if (network.wan.protocol === "static") {
    if (network.wan.ipv4) lines.push(`uci set network.wan.ipaddr=${shellQuote(network.wan.ipv4)}`);
    if (network.wan.netmask) lines.push(`uci set network.wan.netmask=${shellQuote(network.wan.netmask)}`);
    if (network.wan.gateway) lines.push(`uci set network.wan.gateway=${shellQuote(network.wan.gateway)}`);
  }
  if (network.wan.protocol === "pppoe") {
    if (network.wan.username) lines.push(`uci set network.wan.username=${shellQuote(network.wan.username)}`);
    if (network.wan.password) lines.push(`uci set network.wan.password=${shellQuote(network.wan.password)}`);
    if (network.wan.mtu !== undefined) lines.push(`uci set network.wan.mtu=${shellQuote(String(network.wan.mtu))}`);
  }
  if (network.dns.length > 0) {
    lines.push("uci set network.wan.peerdns='0'");
    lines.push(`uci set network.wan.dns=${shellQuote(network.dns.join(" "))}`);
  }

  if (selected.has("switch-port") && network.switchPort) {
    lines.push(`uci set network.wan.device=${shellQuote(network.switchPort.wan)}`);
    if (network.switchPort.lan.length === 1) {
      lines.push(`uci set network.lan.device=${shellQuote(network.switchPort.lan[0]!)}`);
    } else {
      lines.push("uci set network.lan.device='br-lan'");
      lines.push("uci -q delete network.br_lan");
      lines.push("uci set network.br_lan='device'");
      lines.push("uci set network.br_lan.name='br-lan'");
      lines.push("uci set network.br_lan.type='bridge'");
      for (const port of network.switchPort.lan) {
        lines.push(`uci add_list network.br_lan.ports=${shellQuote(port)}`);
      }
    }
  }

  if (selected.has("ipv6")) {
    if (network.ipv6 === "relay") {
      lines.push("uci set network.wan6.proto='relay'");
    } else if (network.ipv6 === "dhcpv6") {
      lines.push("uci set network.wan6.proto='dhcpv6'");
      lines.push("uci set network.wan6.reqaddress='try'");
      lines.push("uci set network.wan6.reqprefix='auto'");
    } else if (network.ipv6 === "ra") {
      lines.push("uci set network.wan6.proto='dhcpv6'");
      lines.push("uci set network.wan6.reqaddress='try'");
      lines.push("uci set network.wan6.reqprefix='no'");
    }
    commits.add("network");
  }

  if (network.bypass) {
    if (network.bypass.gateway) {
      lines.push(`uci set network.lan.gateway=${shellQuote(network.bypass.gateway)}`);
    }
    const bypassDns = network.bypass.dns ?? network.dns;
    if (bypassDns.length > 0) {
      lines.push(`uci set network.lan.dns=${shellQuote(bypassDns.join(" "))}`);
    }
    network.bypass.sourceIps?.forEach((source, index) => {
      lines.push("uci add firewall rule");
      lines.push(`uci set firewall.@rule[-1].name=${shellQuote(`bypass-source-${index}`)}`);
      lines.push(`uci set firewall.@rule[-1].src_ip=${shellQuote(source)}`);
      lines.push("uci set firewall.@rule[-1].dest='wan'");
      lines.push("uci set firewall.@rule[-1].target='ACCEPT'");
      commits.add("firewall");
    });
  }

  lines.push("");
  for (const section of ["network", "dhcp", "wireless", "firewall"]) {
    if (commits.has(section)) lines.push(`uci commit ${section}`);
  }

  if (network.wifi) {
    lines.push("");
    lines.push("uci set wireless.radio0.disabled='0'");
    lines.push(`uci set wireless.radio0.country=${shellQuote(network.wifi.country)}`);
    lines.push(`uci set wireless.radio0.channel=${shellQuote(String(network.wifi.channel))}`);
    lines.push(`uci set wireless.radio0.band=${shellQuote(network.wifi.band)}`);
    lines.push(`uci set wireless.default_radio0.ssid=${shellQuote(network.wifi.ssid)}`);
    lines.push("uci set wireless.default_radio0.mode='ap'");
    if (network.wifi.key) {
      lines.push("uci set wireless.default_radio0.encryption='psk2'");
      lines.push(`uci set wireless.default_radio0.key=${shellQuote(network.wifi.key)}`);
    } else {
      lines.push("uci set wireless.default_radio0.encryption='none'");
    }
    // The wireless commit must come after the wireless sets.
    lines.push("uci commit wireless");
  }

  lines.push("", "exit 0", "");
  return lines.join("\n");
}

function generateOpenwrtRelease(
  declaration: ModeDeclaration,
  input: ModeResolutionInput,
): string {
  const branding = declaration.branding;
  if (!branding) throw new ModeConfigError(`mode "${declaration.id}" has no branding block`);
  const description = branding.description
    ? `${branding.description} ${input.baseVersion}`
    : `${branding.distribId} ${input.baseVersion}`;
  return [
    `DISTRIB_ID=${shellQuote(branding.distribId)}`,
    `DISTRIB_RELEASE=${shellQuote(input.baseVersion)}`,
    `DISTRIB_REVISION=${shellQuote(input.feedCommit.slice(0, 8))}`,
    `DISTRIB_TARGET=${shellQuote(input.targetId)}`,
    `DISTRIB_ARCH=${shellQuote(input.architecture)}`,
    `DISTRIB_DESCRIPTION=${shellQuote(description)}`,
    "DISTRIB_TAINTS=''",
    "",
  ].join("\n");
}

function generateSambaConfig(declaration: ModeDeclaration, hostname: string): string {
  const nas = declaration.nas;
  if (!nas) throw new ModeConfigError(`mode "${declaration.id}" has no nas block`);
  return `config samba
	option name '${nas.shareName}'
	option workgroup 'WORKGROUP'
	option description '${hostname}'
	option homes '0'

config sambashare
	option name '${nas.shareName}'
	option path '${nas.path}'
	option read_only '${nas.readOnly ? "yes" : "no"}'
	option guest_ok '${nas.guestOk ? "yes" : "no"}'
	option create_mask '0664'
	option dir_mask '0775'
`;
}

/**
 * Resolve the base preset and overlays into one typed state. Unknown/malformed
 * input is returned as `issues` (the route answers 400); requirement and
 * exclusivity violations are `conflicts` (409 with a readable reason).
 */
export function resolveModes(
  input: ModeResolutionInput,
  options: ResolveModesOptions = {},
): ModeResolution {
  const network = defaultNetwork(input);
  const basePreset = BASE_PRESETS[input.basePreset ?? "minimal"];
  const baseApplied: AppliedMode = {
    id: basePreset.id,
    layer: "file/board",
    title: basePreset.title,
    experimental: basePreset.experimental,
  };

  const empty = (): ModeState => ({
    basePreset: baseApplied,
    overlays: [],
    experimental: [],
    network,
    secrets: [],
    generatedFiles: [],
  });

  let declarations: readonly ModeDeclaration[];
  try {
    declarations = options.declarations ?? loadModeDeclarations({ directory: options.directory });
  } catch (error) {
    return {
      state: empty(),
      files: [],
      conflicts: [],
      issues: [error instanceof Error ? error.message : String(error)],
      packages: [],
      packageOwners: [],
      kernelConfig: [],
    };
  }

  const byId = new Map(declarations.map((declaration) => [declaration.id, declaration]));
  const issues: string[] = [];
  const conflicts: BuildConflict[] = [];
  const seen = new Set<string>();
  const selected: ModeDeclaration[] = [];

  for (const ref of input.overlays) {
    if (seen.has(ref.id)) {
      issues.push(`Mode "${ref.id}" is selected more than once.`);
      continue;
    }
    seen.add(ref.id);
    const declaration = byId.get(ref.id);
    if (!declaration) {
      issues.push(`Mode "${ref.id}" has no declaration in config/modes.`);
      continue;
    }
    selected.push(declaration);
  }

  if (issues.length > 0) {
    return {
      state: empty(),
      files: [],
      conflicts,
      issues,
      packages: [],
      packageOwners: [],
      kernelConfig: [],
    };
  }

  // Requirement/conflict resolution runs before any content is produced.
  const features = new Set<string>(basePreset.features);
  for (const capability of input.capabilities) features.add(`capability:${capability}`);
  features.add(`engine:${input.engine}`);
  features.add(`filesystem:${input.imageVariant.filesystem}`);
  features.add(`artifact:${input.imageVariant.artifact}`);
  for (const declaration of selected) features.add(`mode:${declaration.id}`);
  if (input.network?.lan?.dhcp?.enabled === true) features.add("feature:dhcp-server");

  for (const declaration of selected) {
    for (const token of declaration.requires ?? []) {
      if (!features.has(token)) {
        conflicts.push({
          names: [declaration.id],
          message: `Mode "${declaration.id}" requires ${describeToken(token)}, but this build does not provide it.`,
        });
      }
    }
    for (const group of declaration.requiresAny ?? []) {
      if (!group.some((token) => features.has(token))) {
        conflicts.push({
          names: [declaration.id],
          message: `Mode "${declaration.id}" requires one of ${group.map(describeToken).join(", ")}, but none is available for this build.`,
        });
      }
    }
    for (const token of declaration.conflicts ?? []) {
      if (token.startsWith("package:")) {
        const name = token.slice("package:".length);
        if (input.packages?.includes(name)) {
          conflicts.push({
            names: [declaration.id, name],
            message: `Mode "${declaration.id}" conflicts with package "${name}", which this build selects.`,
          });
        }
        continue;
      }
      if (features.has(token)) {
        conflicts.push({
          names: [declaration.id],
          message: `Mode "${declaration.id}" conflicts with ${describeToken(token)}.`,
        });
      }
    }
  }

  const exclusiveGroups = new Map<string, string>();
  for (const declaration of selected) {
    if (!declaration.exclusiveGroup) continue;
    const first = exclusiveGroups.get(declaration.exclusiveGroup);
    if (first) {
      conflicts.push({
        names: [first, declaration.id],
        message: `Modes "${first}" and "${declaration.id}" cannot be combined: both set the "${declaration.exclusiveGroup}" mapping.`,
      });
    } else {
      exclusiveGroups.set(declaration.exclusiveGroup, declaration.id);
    }
  }

  // Apply base preset patch, then overlays in selection order, then the typed
  // form overrides (the user always has the last word inside the typed model).
  let resolvedNetwork = mergePatch(network, basePreset.patch);
  for (const declaration of selected) {
    resolvedNetwork = mergePatch(resolvedNetwork, declaration.network);
  }
  resolvedNetwork = applyNetworkInput(resolvedNetwork, input.network);

  const selectedIds = new Set(selected.map((declaration) => declaration.id));
  validateNetwork(resolvedNetwork, selectedIds, issues, conflicts);

  const state: ModeState = {
    basePreset: baseApplied,
    overlays: selected.map(applied),
    experimental: selected.filter((declaration) => declaration.experimental).map((d) => d.id),
    network: resolvedNetwork,
    secrets: [],
    generatedFiles: [],
  };

  if (issues.length > 0) {
    return { state, files: [], conflicts, issues, packages: [], packageOwners: [], kernelConfig: [] };
  }

  const files: GeneratedFile[] = [];
  const generatedPaths: ModeGeneratedPath[] = [];

  const needsNetworkFile =
    basePreset.id !== "minimal" ||
    input.network !== undefined ||
    selected.some((declaration) => NETWORK_MODE_IDS.has(declaration.id));

  if (needsNetworkFile) {
    files.push({
      path: modePlanPath(MODE_UCI_PATH),
      content: generateModeUci(resolvedNetwork, selectedIds),
      mode: 0o755,
    });
    generatedPaths.push(MODE_UCI_PATH);
  }

  for (const declaration of selected) {
    if (declaration.branding) {
      files.push({
        path: modePlanPath(OPENWRT_RELEASE_PATH),
        content: generateOpenwrtRelease(declaration, input),
        mode: 0o644,
      });
      generatedPaths.push(OPENWRT_RELEASE_PATH);
    }
    if (declaration.nas) {
      files.push({
        path: modePlanPath(SAMBA4_CONFIG_PATH),
        content: generateSambaConfig(declaration, input.hostname),
        mode: 0o644,
      });
      generatedPaths.push(SAMBA4_CONFIG_PATH);
    }
    if (declaration.secret) {
      const secret: ModeSecretSpec = {
        kind: declaration.secret.kind,
        commonName: input.hostname,
        certPath: declaration.secret.certPath,
        keyPath: declaration.secret.keyPath,
      };
      state.secrets.push(secret);
    }
  }

  const docker = selected.find((declaration) => declaration.docker)?.docker;
  if (docker) {
    files.push({
      path: modePlanPath(DOCKER_UCI_PATH),
      content: `#!/bin/sh\n# Docker data root (ticket 08): created on first boot, never pulls images.\nmkdir -p ${docker.dataRoot}\n`,
      mode: 0o755,
    });
    generatedPaths.push(DOCKER_UCI_PATH);
  }

  state.generatedFiles = [...new Set(generatedPaths)];

  const packages: string[] = [];
  const packageOwners: Array<{ name: string; mode: string }> = [];
  const kernelConfig: string[] = [];
  for (const declaration of selected) {
    for (const name of declaration.packages ?? []) {
      if (!packages.includes(name)) {
        packages.push(name);
        packageOwners.push({ name, mode: declaration.id });
      }
    }
    for (const line of declaration.kernelConfig ?? []) {
      if (!kernelConfig.includes(line)) kernelConfig.push(line);
    }
  }

  return { state, files, conflicts, issues, packages, packageOwners, kernelConfig, docker };
}
