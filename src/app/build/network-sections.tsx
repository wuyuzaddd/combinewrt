"use client";

import type { NetworkInput } from "@/lib/build/types";

const inputClass =
  "mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500";

interface Props {
  network: NetworkInput;
  selectedModes: string[];
  onChange: (next: NetworkInput) => void;
}

const IPv6_LABELS: Record<string, string> = {
  disabled: "禁用",
  dhcpv6: "DHCPv6 客户端",
  ra: "RA / SLAAC",
  relay: "中继",
};

const BAND_LABELS: Record<string, string> = {
  "2g": "2.4 GHz",
  "5g": "5 GHz",
  "6g": "6 GHz",
};

function splitList(value: string): string[] {
  return value
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Typed network form (ticket 15). Every field maps to `NetworkInput`; there is
 * deliberately no raw UCI/shell textarea anywhere. PPPoE passwords use a
 * password input and are never echoed into the plan preview or source offer.
 */
export function NetworkSections({ network, selectedModes, onChange }: Props) {
  const set = (patch: Partial<NetworkInput>) => onChange({ ...network, ...patch });
  const wan = network.wan ?? { protocol: "dhcp" as const };
  const dhcp = network.lan?.dhcp ?? { enabled: true };

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
      <h2 className="font-medium">网络（typed 字段）</h2>
      <p className="mt-1 text-xs text-slate-500">
        这里只提交结构化字段，不生成自由文本 UCI。PPPoE 密码只作为单次构建的 secret 传给计划，不回显。
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <fieldset className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
          <legend className="px-1 text-xs uppercase tracking-wider text-slate-500">LAN / DHCP</legend>
          <label className="mt-1 flex items-center gap-2 text-sm text-slate-300">
            <input
              checked={dhcp.enabled}
              onChange={(event) =>
                set({ lan: { dhcp: { ...dhcp, enabled: event.target.checked } } })
              }
              type="checkbox"
            />
            启用 DHCP 服务
          </label>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <label className="block text-xs text-slate-400">
              起始地址
              <input
                className={inputClass}
                disabled={!dhcp.enabled}
                min={1}
                onChange={(event) =>
                  set({
                    lan: { dhcp: { ...dhcp, start: Number(event.target.value) || undefined } },
                  })
                }
                type="number"
                value={dhcp.start ?? ""}
              />
            </label>
            <label className="block text-xs text-slate-400">
              数量
              <input
                className={inputClass}
                disabled={!dhcp.enabled}
                min={1}
                onChange={(event) =>
                  set({
                    lan: { dhcp: { ...dhcp, limit: Number(event.target.value) || undefined } },
                  })
                }
                type="number"
                value={dhcp.limit ?? ""}
              />
            </label>
            <label className="block text-xs text-slate-400">
              租期
              <input
                className={inputClass}
                disabled={!dhcp.enabled}
                onChange={(event) => set({ lan: { dhcp: { ...dhcp, lease: event.target.value || undefined } } })}
                placeholder="12h"
                value={dhcp.lease ?? ""}
              />
            </label>
          </div>
        </fieldset>

        <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
          <h3 className="text-xs uppercase tracking-wider text-slate-500">WAN</h3>
          <label className="mt-2 block text-xs text-slate-400">
            协议
            <select
              className={inputClass}
              onChange={(event) => set({ wan: { ...wan, protocol: event.target.value as typeof wan.protocol } })}
              value={wan.protocol}
            >
              <option value="dhcp">DHCP</option>
              <option value="static">静态地址</option>
              <option value="pppoe">PPPoE</option>
            </select>
          </label>
          {selectedModes.includes("wan-eth0") ? (
            <label className="mt-2 block text-xs text-slate-400">
              WAN 设备
              <input
                className={inputClass}
                onChange={(event) => set({ wan: { ...wan, device: event.target.value || undefined } })}
                placeholder="eth0"
                value={wan.device ?? ""}
              />
            </label>
          ) : null}
          {wan.protocol === "static" ? (
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <label className="block text-xs text-slate-400">
                IPv4
                <input
                  className={inputClass}
                  onChange={(event) => set({ wan: { ...wan, ipv4: event.target.value || undefined } })}
                  value={wan.ipv4 ?? ""}
                />
              </label>
              <label className="block text-xs text-slate-400">
                掩码
                <input
                  className={inputClass}
                  onChange={(event) => set({ wan: { ...wan, netmask: event.target.value || undefined } })}
                  value={wan.netmask ?? ""}
                />
              </label>
              <label className="block text-xs text-slate-400">
                网关
                <input
                  className={inputClass}
                  onChange={(event) => set({ wan: { ...wan, gateway: event.target.value || undefined } })}
                  value={wan.gateway ?? ""}
                />
              </label>
            </div>
          ) : null}
          {wan.protocol === "pppoe" ? (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className="block text-xs text-slate-400">
                用户名
                <input
                  autoComplete="off"
                  className={inputClass}
                  onChange={(event) => set({ wan: { ...wan, username: event.target.value || undefined } })}
                  value={wan.username ?? ""}
                />
              </label>
              <label className="block text-xs text-slate-400">
                密码
                <input
                  autoComplete="new-password"
                  className={inputClass}
                  onChange={(event) => set({ wan: { ...wan, password: event.target.value || undefined } })}
                  type="password"
                  value={wan.password ?? ""}
                />
              </label>
            </div>
          ) : null}
        </div>

        <fieldset className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
          <legend className="px-1 text-xs uppercase tracking-wider text-slate-500">DNS</legend>
          <label className="block text-xs text-slate-400">
            DNS 服务器（逗号分隔）
            <input
              className={inputClass}
              onChange={(event) => set({ dns: splitList(event.target.value) })}
              placeholder="223.5.5.5, 1.1.1.1"
              value={(network.dns ?? []).join(", ")}
            />
          </label>
        </fieldset>

        <fieldset className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
          <legend className="px-1 text-xs uppercase tracking-wider text-slate-500">IPv6</legend>
          <label className="block text-xs text-slate-400">
            模式
            <select
              className={inputClass}
              onChange={(event) => set({ ipv6: event.target.value as NetworkInput["ipv6"] })}
              value={network.ipv6 ?? "disabled"}
            >
              {Object.entries(IPv6_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {!selectedModes.includes("ipv6") && network.ipv6 !== "disabled" ? (
            <p className="mt-1 text-[11px] text-amber-400">非禁用 IPv6 需要同时选择 ipv6 overlay。</p>
          ) : null}
        </fieldset>
      </div>

      {selectedModes.includes("wifi") ? (
        <fieldset className="mt-4 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
          <legend className="px-1 text-xs uppercase tracking-wider text-slate-500">WiFi</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-4">
            <label className="block text-xs text-slate-400">
              SSID
              <input
                className={inputClass}
                onChange={(event) =>
                  set({
                    wifi: {
                      ssid: event.target.value,
                      key: network.wifi?.key,
                      country: network.wifi?.country ?? "CN",
                      channel: network.wifi?.channel ?? 36,
                      band: network.wifi?.band ?? "5g",
                    },
                  })
                }
                value={network.wifi?.ssid ?? ""}
              />
            </label>
            <label className="block text-xs text-slate-400">
              密码
              <input
                autoComplete="new-password"
                className={inputClass}
                onChange={(event) =>
                  set({
                    wifi: {
                      ssid: network.wifi?.ssid ?? "",
                      key: event.target.value || undefined,
                      country: network.wifi?.country ?? "CN",
                      channel: network.wifi?.channel ?? 36,
                      band: network.wifi?.band ?? "5g",
                    },
                  })
                }
                type="password"
                value={network.wifi?.key ?? ""}
              />
            </label>
            <label className="block text-xs text-slate-400">
              国家码
              <input
                className={inputClass}
                maxLength={2}
                onChange={(event) =>
                  set({
                    wifi: {
                      ssid: network.wifi?.ssid ?? "",
                      key: network.wifi?.key,
                      country: event.target.value.toUpperCase(),
                      channel: network.wifi?.channel ?? 36,
                      band: network.wifi?.band ?? "5g",
                    },
                  })
                }
                value={network.wifi?.country ?? "CN"}
              />
            </label>
            <label className="block text-xs text-slate-400">
              信道 / 频段
              <span className="mt-1 flex gap-2">
                <input
                  className={inputClass}
                  min={1}
                  onChange={(event) =>
                    set({
                      wifi: {
                        ssid: network.wifi?.ssid ?? "",
                        key: network.wifi?.key,
                        country: network.wifi?.country ?? "CN",
                        channel: Number(event.target.value) || 1,
                        band: network.wifi?.band ?? "5g",
                      },
                    })
                  }
                  type="number"
                  value={network.wifi?.channel ?? 36}
                />
                <select
                  className={inputClass}
                  onChange={(event) =>
                    set({
                      wifi: {
                        ssid: network.wifi?.ssid ?? "",
                        key: network.wifi?.key,
                        country: network.wifi?.country ?? "CN",
                        channel: network.wifi?.channel ?? 36,
                        band: event.target.value as "2g" | "5g" | "6g",
                      },
                    })
                  }
                  value={network.wifi?.band ?? "5g"}
                >
                  {Object.entries(BAND_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </span>
            </label>
          </div>
        </fieldset>
      ) : null}

      {selectedModes.includes("switch-port") ? (
        <fieldset className="mt-4 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
          <legend className="px-1 text-xs uppercase tracking-wider text-slate-500">Switch 端口映射</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className="block text-xs text-slate-400">
              WAN 端口
              <input
                className={inputClass}
                onChange={(event) =>
                  set({
                    switchPort: {
                      wan: event.target.value,
                      lan: network.switchPort?.lan ?? ["lan1", "lan2", "lan3"],
                    },
                  })
                }
                placeholder="wan"
                value={network.switchPort?.wan ?? "wan"}
              />
            </label>
            <label className="block text-xs text-slate-400">
              LAN 端口（逗号分隔）
              <input
                className={inputClass}
                onChange={(event) =>
                  set({
                    switchPort: {
                      wan: network.switchPort?.wan ?? "wan",
                      lan: splitList(event.target.value),
                    },
                  })
                }
                value={(network.switchPort?.lan ?? ["lan1", "lan2", "lan3"]).join(", ")}
              />
            </label>
          </div>
        </fieldset>
      ) : null}

      {selectedModes.includes("bypass") ? (
        <fieldset className="mt-4 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
          <legend className="px-1 text-xs uppercase tracking-wider text-slate-500">旁路网关</legend>
          <p className="mt-1 text-[11px] text-slate-500">
            选中旁路由后会自动关闭 LAN DHCP 服务，WAN 不再配置（生成时强制 `wan.proto=none`），
            IPv6 委派也会关闭（除非同时启用 IPv6 模式）。WAN 区域的取值此时不生效。
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className="block text-xs text-slate-400">
              网关
              <input
                className={inputClass}
                onChange={(event) =>
                  set({ bypass: { ...network.bypass, gateway: event.target.value || undefined } })
                }
                value={network.bypass?.gateway ?? ""}
              />
            </label>
            <label className="block text-xs text-slate-400">
              来源地址（IPv4/CIDR，逗号分隔）
              <input
                className={inputClass}
                onChange={(event) =>
                  set({ bypass: { ...network.bypass, sourceIps: splitList(event.target.value) } })
                }
                value={(network.bypass?.sourceIps ?? []).join(", ")}
              />
            </label>
          </div>
        </fieldset>
      ) : null}
    </section>
  );
}
