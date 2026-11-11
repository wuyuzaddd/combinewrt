import type { BuildConflict } from "./types";

const RULES: Array<{ names: [string, string]; message: string }> = [
  { names: ["dnsmasq", "dnsmasq-full"], message: "dnsmasq 与 dnsmasq-full 不能同时安装" },
  { names: ["firewall3", "firewall4"], message: "firewall3 与 firewall4 不能同时安装" },
  { names: ["opkg", "apk"], message: "opkg 与 apk 不能同时安装" },
];

export function findConflicts(names: string[]): BuildConflict[] {
  const present = new Set(names);
  return RULES.filter((rule) => rule.names.every((name) => present.has(name))).map((rule) => ({
    names: [...rule.names],
    message: rule.message,
  }));
}
