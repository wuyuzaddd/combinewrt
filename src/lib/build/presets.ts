export type PresetName = "common" | "minimal";

export const COMMON_PACKAGES: readonly string[] = [
  "luci",
  "luci-ssl",
  "luci-app-firewall",
  "luci-app-ttyd",
  "luci-app-samba4",
  "luci-app-netdata",
  "luci-app-diskman",
  "luci-app-smartdns",
  "luci-app-mosdns",
  "luci-app-lucky",
  "luci-app-argon-config",
  "luci-theme-argon",
  "luci-proto-wireguard",
  "wireguard-tools",
  "openssh-sftp-server",
  "curl",
  "htop",
  "nano",
];

export const MINIMAL_PACKAGES: readonly string[] = [];

export function presetPackages(name: PresetName): readonly string[] {
  return name === "common" ? COMMON_PACKAGES : MINIMAL_PACKAGES;
}
