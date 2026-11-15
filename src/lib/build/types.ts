import type { ImageFormatId, PackageSource } from "../catalog/types";
import type { AcquisitionStrategy, SourceLayer } from "../sources/types";
import type { BasePresetId, ImageVariant, ModeLayer, ModeRef } from "../domain/types";

export interface RequestedPackage {
  name: string;
  source?: PackageSource;
  version?: string;
}

export interface PackagePin {
  name: string;
  source?: PackageSource;
  version?: string;
  sha256?: string;
}

export type BuildVisibility = "private" | "public";

export interface BuildFormInput {
  profile: string;
  imageType: ImageFormatId;
  hostname: string;
  timezone: string;
  lanIp: string;
  netmask: string;
  rootPassword: string;
  packages: string[];
  packagePins?: PackagePin[];
  visibility?: BuildVisibility;
}

/**
 * Input of the V2 planner. V1 fields remain readable so a V1 form (or a stored
 * V1 plan's config) can still be loaded; the target/profile/variant triple is
 * what makes a form V2. `imageType` is optional because the composer derives it
 * from the image variant.
 */
export interface BuildFormInputV2 extends Omit<BuildFormInput, "imageType"> {
  imageType?: ImageFormatId;
  target: string;
  kernelLine: string;
  imageVariant: ImageVariant;
  /** Base preset id; the composer defaults to `minimal`. */
  basePreset?: BasePresetId;
  /** Declared configuration modes that stack on the base preset (ticket 07). */
  modes?: ModeRef[];
  /**
   * Typed network overrides. There is deliberately no free-form UCI or shell
   * field: modes and this section may only set the fields modelled here.
   */
  network?: NetworkInput;
}

export type Ipv6Mode = "disabled" | "dhcpv6" | "ra" | "relay";

export type WanProtocol = "dhcp" | "static" | "pppoe";

export type WifiBand = "2g" | "5g" | "6g";

export interface DhcpServerConfig {
  enabled: boolean;
  /** First host address handed out; 1..254. */
  start?: number;
  /** Number of addresses in the pool; 1..253. */
  limit?: number;
  /** dnsmasq lease time such as `12h` or `1d`. */
  lease?: string;
}

export interface LanNetworkConfig {
  ipv4: string;
  netmask: string;
  dhcp: DhcpServerConfig;
}

export interface WanNetworkConfig {
  protocol: WanProtocol;
  /** Interface id such as `eth0`, or `default` for the stock mapping. */
  device?: string;
  ipv4?: string;
  netmask?: string;
  gateway?: string;
  /** PPPoE credentials; the password is a per-build secret. */
  username?: string;
  password?: string;
  mtu?: number;
}

export interface WifiNetworkConfig {
  ssid: string;
  /** WPA2 passphrase; omitted for an open network. */
  key?: string;
  /** Two-letter regulatory country code. */
  country: string;
  channel: number;
  band: WifiBand;
}

export interface SwitchPortConfig {
  wan: string;
  lan: string[];
}

export interface BypassConfig {
  gateway?: string;
  dns?: string[];
  /** Source addresses (IPv4 or CIDR) routed through the bypass gateway. */
  sourceIps?: string[];
}

export interface NetworkConfig {
  lan: LanNetworkConfig;
  wan: WanNetworkConfig;
  dns: string[];
  ipv6: Ipv6Mode;
  wifi: WifiNetworkConfig | null;
  switchPort: SwitchPortConfig | null;
  bypass: BypassConfig | null;
}

/** The typed subset a form may override; every field is validated at plan time. */
export interface NetworkInput {
  lan?: { dhcp?: DhcpServerConfig };
  wan?: WanNetworkConfig;
  dns?: string[];
  ipv6?: Ipv6Mode;
  wifi?: WifiNetworkConfig;
  switchPort?: SwitchPortConfig;
  bypass?: BypassConfig;
}

export interface AppliedMode {
  id: string;
  layer: ModeLayer;
  title: string;
  experimental: boolean;
}

/**
 * A per-build secret the workflow materialises inside the image. The secret
 * material itself never enters the plan: only where it belongs and what it is.
 */
export interface ModeSecretSpec {
  kind: "https-selfsigned";
  commonName: string;
  certPath: string;
  keyPath: string;
}

/** The resolved mode stack plus the typed network it produces. */
export interface ModeState {
  basePreset: AppliedMode;
  overlays: AppliedMode[];
  experimental: string[];
  network: NetworkConfig;
  secrets: ModeSecretSpec[];
  /** Image paths (without the `files/` plan prefix) this mode stack writes. */
  generatedFiles: string[];
}

export interface PackageLookupEntry {
  version: string;
  depends: string[];
  source: PackageSource;
  sourcePin: string;
  sha256: string | null;
  filename: string | null;
  downloadUrl: string | null;
  feed: string;
  license?: string | null;
  proprietary?: boolean;
}

export type PackageLookup = (name: string) => PackageLookupEntry | null;
export type PackageLookupAll = (name: string) => PackageLookupEntry[];

export interface BuildConfig {
  profile: string;
  imageType: ImageFormatId;
  hostname: string;
  timezone: string;
  lanIp: string;
  netmask: string;
  packages: string[];
  visibility?: BuildVisibility;
}

export interface ResolvedEntry {
  name: string;
  version: string | null;
  source: "selected" | "dependency";
  packageSource: PackageSource | null;
  sourcePin: string | null;
  sha256: string | null;
  feed: string | null;
  license?: string | null;
  proprietary?: boolean;
  /** Acquisition strategy the registry asks for (V2 plans only). */
  requestedStrategy?: AcquisitionStrategy;
  /** Strategy the planner will actually use (V2 plans only). */
  effectiveStrategy?: AcquisitionStrategy;
  /** Why `effectiveStrategy` differs from `requestedStrategy` (V2 plans only). */
  fallbackReason?: string;
}

export interface AppliedPatch {
  name: string;
  license: "GPL-2.0-only";
  source: string;
}

export interface DownloadEntry {
  name: string;
  version: string;
  source: Exclude<PackageSource, "official">;
  sourcePin: string;
  url: string;
  filename: string;
  sha256: string;
}

export interface BuildConflict {
  names: string[];
  message: string;
}

export interface GeneratedFile {
  path: string;
  content: string;
  mode: number;
}

export type { AcquisitionStrategy, SourceLayer };
export type { BuildPlan, BuildPlanV1, BuildPlanV2 } from "../domain/build-plan";
