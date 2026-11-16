import { describe, expect, it } from "vitest";
import { loadCapabilities } from "../catalog/capabilities";
import {
  DOCKER_UCI_PATH,
  MODE_FILE_WHITELIST,
  MODE_UCI_PATH,
  OPENWRT_RELEASE_PATH,
  SAMBA4_CONFIG_PATH,
  loadModeDeclarations,
  modeDeclarationSchema,
  resolveModes,
  validateModeDeclarations,
  type ModeResolutionInput,
} from "./modes";

const declarations = loadModeDeclarations();
const imageBuilderCapabilities = ["efi", "legacy", "ext4", "squashfs", "combined", "rootfs", "overlay"];

const baseInput: ModeResolutionInput = {
  overlays: [],
  hostname: "router",
  baseVersion: "25.12.2",
  feedCommit: "feed1234567890",
  targetId: "x86/64",
  architecture: "x86_64",
  imageVariant: { boot: "efi", filesystem: "ext4", artifact: "combined" },
  engine: "imagebuilder",
  capabilities: imageBuilderCapabilities,
  lanIp: "192.168.1.1",
  netmask: "255.255.255.0",
};

function resolve(overrides: Partial<ModeResolutionInput>) {
  return resolveModes({ ...baseInput, ...overrides });
}

describe("mode declarations", () => {
  it("declares exactly the modes of the capability registry, with the same layer/experimental flags", () => {
    const registry = loadCapabilities();
    expect(declarations).toHaveLength(16);
    expect(declarations.map((item) => item.id).sort()).toEqual(
      registry.modes.map((mode) => mode.id).sort(),
    );
    expect(validateModeDeclarations(declarations, registry.modes)).toEqual([]);
  });

  it("rejects generated files outside the controlled whitelist", () => {
    const parsed = modeDeclarationSchema.safeParse({
      id: "evil",
      layer: "file/board",
      title: "Evil",
      experimental: false,
      generatedFiles: ["/etc/shadow"],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects free-form escape hatches", () => {
    const parsed = modeDeclarationSchema.safeParse({
      id: "evil",
      layer: "file/board",
      title: "Evil",
      experimental: false,
      shell: "rm -rf /",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a requirement token that is not typed", () => {
    const parsed = modeDeclarationSchema.safeParse({
      id: "evil",
      layer: "file/board",
      title: "Evil",
      experimental: false,
      requires: ["run:curl"],
    });
    expect(parsed.success).toBe(false);
  });
});

describe("mode resolution", () => {
  it("applies a base preset before overlays", () => {
    const result = resolve({
      basePreset: "router-default",
      overlays: [{ id: "ipv6", layer: "file/board" }],
    });
    expect(result.issues).toEqual([]);
    expect(result.conflicts).toEqual([]);
    expect(result.state.basePreset).toMatchObject({ id: "router-default", title: "Router default" });
    expect(result.state.network.wan).toMatchObject({ protocol: "dhcp", device: "default" });
    expect(result.state.network.ipv6).toBe("dhcpv6");

    const file = result.files.find((item) => item.path === `files${MODE_UCI_PATH}`);
    expect(file?.mode).toBe(0o755);
    expect(file?.content).toContain("uci set network.wan6.proto='dhcpv6'");
  });

  it("maps WAN to eth0 and stays compatible with the minimal base preset", () => {
    const result = resolve({ overlays: [{ id: "wan-eth0", layer: "file/board" }] });
    expect(result.issues).toEqual([]);
    expect(result.conflicts).toEqual([]);
    expect(result.state.network.wan.device).toBe("eth0");
    const file = result.files.find((item) => item.path === `files${MODE_UCI_PATH}`);
    expect(file?.content).toContain("uci set network.wan.device='eth0'");
  });

  it("keeps wan-eth0 and switch-port mutually exclusive", () => {
    const result = resolve({
      overlays: [
        { id: "wan-eth0", layer: "file/board" },
        { id: "switch-port", layer: "file/board" },
      ],
      network: { switchPort: { wan: "wan", lan: ["lan1", "lan2"] } },
    });
    expect(result.issues).toEqual([]);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].names).toEqual(expect.arrayContaining(["wan-eth0", "switch-port"]));
    expect(result.conflicts[0].message).toContain("wan-mapping");
  });

  it("rejects wan-eth0 on the default WAN mapping", () => {
    const result = resolve({
      basePreset: "router-default",
      overlays: [{ id: "wan-eth0", layer: "file/board" }],
    });
    expect(result.conflicts.map((conflict) => conflict.message).join("\n")).toContain(
      "default WAN mapping",
    );
  });

  it("rejects bypass next to a DHCP server", () => {
    const withDefault = resolve({
      basePreset: "router-default",
      overlays: [{ id: "bypass", layer: "file/board" }],
    });
    expect(withDefault.conflicts.map((conflict) => conflict.message).join("\n")).toMatch(/DHCP server/);

    const withExplicitDhcp = resolve({
      overlays: [{ id: "bypass", layer: "file/board" }],
      network: { lan: { dhcp: { enabled: true } } },
    });
    expect(withExplicitDhcp.conflicts.map((conflict) => conflict.message).join("\n")).toMatch(
      /DHCP server/,
    );

    const ok = resolve({ overlays: [{ id: "bypass", layer: "file/board" }] });
    expect(ok.conflicts).toEqual([]);
    expect(ok.state.network.lan.dhcp.enabled).toBe(false);
  });

  it("requires a radio capability or the usb-wifi overlay for wifi", () => {
    const wifiNetwork = {
      ssid: "combinewrt",
      key: "correct horse",
      country: "CN",
      channel: 36,
      band: "5g" as const,
    };
    const withoutRadio = resolve({
      overlays: [{ id: "wifi", layer: "file/board" }],
      network: { wifi: wifiNetwork },
    });
    expect(withoutRadio.conflicts.map((conflict) => conflict.message).join("\n")).toMatch(/radio/);

    const withUsbWifi = resolve({
      overlays: [
        { id: "wifi", layer: "file/board" },
        { id: "usb-wifi", layer: "package/kernel" },
      ],
      network: { wifi: wifiNetwork },
    });
    expect(withUsbWifi.conflicts).toEqual([]);
    expect(withUsbWifi.state.experimental).toEqual(
      expect.arrayContaining(["wifi", "usb-wifi"]),
    );
    const file = withUsbWifi.files.find((item) => item.path === `files${MODE_UCI_PATH}`);
    expect(file?.content).toContain("wireless.default_radio0.ssid='combinewrt'");
    expect(file?.content).toContain("wireless.radio0.band='5g'");
    expect(file?.content).toContain("wireless.radio0.channel='36'");
  });

  it("rejects wifi without typed wifi settings", () => {
    const result = resolve({
      overlays: [
        { id: "wifi", layer: "file/board" },
        { id: "usb-wifi", layer: "package/kernel" },
      ],
    });
    expect(result.issues.join("\n")).toMatch(/network\.wifi/);
  });

  it("rejects docker on squashfs and accepts it on ext4/source", () => {
    const squashfs = resolve({
      engine: "source",
      imageVariant: { boot: "efi", filesystem: "squashfs", artifact: "combined" },
      overlays: [{ id: "docker", layer: "kernel/config" }],
    });
    expect(squashfs.conflicts.map((conflict) => conflict.message).join("\n")).toMatch(/ext4/);

    const ext4 = resolve({
      engine: "source",
      overlays: [{ id: "docker", layer: "kernel/config" }],
    });
    expect(ext4.conflicts).toEqual([]);
    // Ticket 08: the docker preset owns the data root, so it contributes a
    // first-boot uci-defaults file rather than only a package list.
    expect(ext4.files.map((file) => file.path)).toEqual([`files${DOCKER_UCI_PATH}`]);
  });

  it("requires the ext4/combined variant of docker to be named in the conflict", () => {
    const rootfsSquashfs = resolve({
      engine: "source",
      imageVariant: { boot: "efi", filesystem: "squashfs", artifact: "rootfs" },
      overlays: [{ id: "docker", layer: "kernel/config" }],
    });
    expect(rootfsSquashfs.conflicts.length).toBeGreaterThanOrEqual(2);
    expect(rootfsSquashfs.conflicts.map((conflict) => conflict.message).join("\n")).toMatch(/combined/);
  });

  it("records the HTTPS secret as a spec and never as key material", () => {
    const result = resolve({ overlays: [{ id: "https-selfsigned", layer: "file/board" }] });
    expect(result.issues).toEqual([]);
    expect(result.files).toEqual([]);
    expect(result.state.secrets).toEqual([
      {
        kind: "https-selfsigned",
        commonName: "router",
        certPath: "/etc/uhttpd.crt",
        keyPath: "/etc/uhttpd.key",
      },
    ]);
    const serialized = JSON.stringify({ state: result.state, files: result.files });
    expect(serialized).not.toMatch(/PRIVATE KEY/);
  });

  it("keeps the PPPoE password out of validation messages", () => {
    const result = resolve({
      overlays: [{ id: "pppoe", layer: "file/board" }],
      network: { wan: { protocol: "pppoe", username: "", password: "supersecret" } },
    });
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.join("\n")).not.toContain("supersecret");
    expect(result.issues.join("\n")).toMatch(/username/);
  });

  it("writes the PPPoE credentials only into the generated file", () => {
    const result = resolve({
      overlays: [{ id: "pppoe", layer: "file/board" }],
      network: {
        wan: { protocol: "pppoe", username: "user@example", password: "supersecret", mtu: 1492 },
      },
    });
    expect(result.issues).toEqual([]);
    expect(result.state.network.wan.protocol).toBe("pppoe");
    const file = result.files.find((item) => item.path === `files${MODE_UCI_PATH}`);
    expect(file?.content).toContain("uci set network.wan.username='user@example'");
    expect(file?.content).toContain("uci set network.wan.password='supersecret'");
    expect(file?.content).toContain("uci set network.wan.mtu='1492'");
  });

  it("rejects an invalid LAN DHCP pool", () => {
    const result = resolve({
      network: { lan: { dhcp: { enabled: true, start: 250, limit: 10 } } },
    });
    expect(result.issues.join("\n")).toMatch(/pool runs past/);
  });

  it("rejects a static WAN gateway outside its subnet", () => {
    const result = resolve({
      network: {
        wan: {
          protocol: "static",
          ipv4: "192.168.1.10",
          netmask: "255.255.255.0",
          gateway: "10.0.0.1",
        },
      },
    });
    expect(result.issues.join("\n")).toMatch(/outside the WAN subnet/);
  });

  it("rejects PPPoE fields without the pppoe protocol", () => {
    const result = resolve({
      network: { wan: { protocol: "dhcp", username: "user" } },
    });
    expect(result.issues.join("\n")).toMatch(/PPPoE fields/);
  });

  it("rejects switch-port without a port map and a WAN port reused as LAN", () => {
    const missing = resolve({ overlays: [{ id: "switch-port", layer: "file/board" }] });
    expect(missing.issues.join("\n")).toMatch(/network\.switchPort/);

    const reused = resolve({
      overlays: [{ id: "switch-port", layer: "file/board" }],
      network: { switchPort: { wan: "wan", lan: ["wan", "lan1"] } },
    });
    expect(reused.issues.join("\n")).toMatch(/WAN port cannot also be a LAN port/);
  });

  it("generates the switch-port mapping", () => {
    const result = resolve({
      overlays: [{ id: "switch-port", layer: "file/board" }],
      network: { switchPort: { wan: "wan", lan: ["lan1", "lan2"] } },
    });
    expect(result.issues).toEqual([]);
    const file = result.files.find((item) => item.path === `files${MODE_UCI_PATH}`);
    expect(file?.content).toContain("uci set network.wan.device='wan'");
    expect(file?.content).toContain("uci set network.lan.device='br-lan'");
    expect(file?.content).toContain("uci set network.br_lan.type='bridge'");
    expect(file?.content).toContain("uci add_list network.br_lan.ports='lan1'");
    expect(file?.content).toContain("uci add_list network.br_lan.ports='lan2'");

    const single = resolve({
      overlays: [{ id: "switch-port", layer: "file/board" }],
      network: { switchPort: { wan: "wan", lan: ["lan1"] } },
    });
    const singleFile = single.files.find((item) => item.path === `files${MODE_UCI_PATH}`);
    expect(singleFile?.content).toContain("uci set network.lan.device='lan1'");
    expect(singleFile?.content).not.toContain("br_lan");
  });

  it("rejects IPv6 settings without the ipv6 mode and vice versa", () => {
    const withoutMode = resolve({ network: { ipv6: "dhcpv6" } });
    expect(withoutMode.issues.join("\n")).toMatch(/ipv6.*mode/);

    const disabled = resolve({
      overlays: [{ id: "ipv6", layer: "file/board" }],
      network: { ipv6: "disabled" },
    });
    expect(disabled.issues.join("\n")).toMatch(/disabled/);
  });

  it("rejects a duplicate mode selection", () => {
    const result = resolve({
      overlays: [
        { id: "ipv6", layer: "file/board" },
        { id: "ipv6", layer: "file/board" },
      ],
    });
    expect(result.issues.join("\n")).toMatch(/more than once/);
  });

  it("reports a selection without a declaration", () => {
    const result = resolveModes(
      { ...baseInput, overlays: [{ id: "wan-eth0", layer: "file/board" }] },
      { declarations: [] },
    );
    expect(result.issues.join("\n")).toMatch(/no declaration/);
  });
});

describe("generated files", () => {
  it("keeps every generated path inside the whitelist", () => {
    const result = resolve({
      overlays: [
        { id: "istoreos-brand", layer: "file/board" },
        { id: "nas", layer: "package/kernel" },
        { id: "ipv6", layer: "file/board" },
      ],
    });
    expect(result.issues).toEqual([]);
    expect(result.files.length).toBeGreaterThan(0);
    const allowed = new Set(MODE_FILE_WHITELIST.map((path) => `files${path}`));
    for (const file of result.files) {
      expect(allowed.has(file.path)).toBe(true);
    }
    expect(result.state.generatedFiles).toEqual(
      expect.arrayContaining([MODE_UCI_PATH, OPENWRT_RELEASE_PATH, SAMBA4_CONFIG_PATH]),
    );
  });

  it("writes only identity fields for iStoreOS branding", () => {
    const result = resolve({ overlays: [{ id: "istoreos-brand", layer: "file/board" }] });
    const file = result.files.find((item) => item.path === `files${OPENWRT_RELEASE_PATH}`);
    expect(file?.content).toContain("DISTRIB_ID='iStoreOS'");
    expect(file?.content).toContain("DISTRIB_DESCRIPTION='iStoreOS 25.12.2'");
    expect(file?.content).not.toMatch(/opkg|istore|install/);
    expect(result.files.find((item) => item.path === `files${MODE_UCI_PATH}`)).toBeUndefined();
  });

  it("writes a default share for NAS without disk operations", () => {
    const result = resolve({ overlays: [{ id: "nas", layer: "package/kernel" }] });
    const file = result.files.find((item) => item.path === `files${SAMBA4_CONFIG_PATH}`);
    expect(file?.content).toContain("config sambashare");
    expect(file?.content).toContain("option path '/mnt'");
    expect(file?.content).not.toMatch(/mkfs|fdisk|parted|mount\b/);
    expect(result.files.find((item) => item.path === `files${MODE_UCI_PATH}`)).toBeUndefined();
  });

  it("never logs or plans key material for https-selfsigned", () => {
    const result = resolve({ overlays: [{ id: "https-selfsigned", layer: "file/board" }] });
    expect(result.state.secrets).toHaveLength(1);
    expect(JSON.stringify(result)).not.toMatch(/BEGIN (RSA |EC )?PRIVATE KEY/);
    expect(JSON.stringify(result)).not.toContain("-----BEGIN");
  });
});

describe("package and kernel presets (ticket 08)", () => {
  const byId = new Map(declarations.map((declaration) => [declaration.id, declaration]));

  it("declares package sets for the package/kernel modes and the NAS disk tools", () => {
    for (const id of ["usb-wired", "usb-wifi", "wwan", "nas", "docker"]) {
      const declaration = byId.get(id);
      expect(declaration, id).toBeDefined();
      expect(declaration!.packages?.length ?? 0, id).toBeGreaterThan(0);
      for (const name of declaration!.packages ?? []) {
        expect(name, `${id}: ${name}`).toMatch(/^[A-Za-z0-9][A-Za-z0-9+._-]*$/);
      }
    }

    expect(byId.get("usb-wired")!.experimental).toBe(true);
    expect(byId.get("usb-wifi")!.experimental).toBe(true);
    expect(byId.get("wwan")!.experimental).toBe(true);
    expect(byId.get("usb-wired")!.packages).toEqual(
      expect.arrayContaining(["kmod-usb-net-cdc-ether", "kmod-usb-net", "usb-modeswitch"]),
    );
    expect(byId.get("usb-wifi")!.packages).toEqual(expect.arrayContaining(["kmod-mac80211", "kmod-cfg80211"]));
    expect(byId.get("wwan")!.packages).toEqual(
      expect.arrayContaining(["kmod-usb-net-qmi-wwan", "uqmi", "umbim"]),
    );
    expect(byId.get("nas")!.packages).toEqual(
      expect.arrayContaining(["samba4-server", "luci-app-samba4", "kmod-usb-storage", "block-mount"]),
    );
  });

  it("declares the docker package set, kernel fragment and writable data root", () => {
    const docker = byId.get("docker")!;

    expect(docker.layer).toBe("kernel/config");
    expect(docker.packages).toEqual(expect.arrayContaining(["docker", "dockerd", "containerd", "runc"]));
    expect(docker.kernelConfig).toEqual(
      expect.arrayContaining(["CONFIG_OVERLAY_FS=y", "CONFIG_CGROUPS=y", "CONFIG_NAMESPACES=y"]),
    );
    for (const line of docker.kernelConfig ?? []) {
      expect(line).toMatch(/^CONFIG_[A-Z0-9_]+=(y|m)$/);
    }
    expect(docker.docker?.dataRoot).toBe("/var/lib/docker");
    expect(docker.requires).toEqual(
      expect.arrayContaining(["engine:source", "filesystem:ext4", "artifact:combined"]),
    );
    expect(docker.conflicts).toEqual(expect.arrayContaining(["package:podman"]));
  });

  it("only allows a kernel config fragment on the kernel/config layer", () => {
    const wrongLayer = modeDeclarationSchema.safeParse({
      id: "bad-kernel-config",
      layer: "package/kernel",
      title: "Bad",
      experimental: false,
      kernelConfig: ["CONFIG_X=y"],
    });
    const rightLayer = modeDeclarationSchema.safeParse({
      id: "good-kernel-config",
      layer: "kernel/config",
      title: "Good",
      experimental: false,
      kernelConfig: ["CONFIG_X=y"],
    });

    expect(wrongLayer.success).toBe(false);
    expect(rightLayer.success).toBe(true);
  });

  it("rejects a malformed package name in a mode package set", () => {
    const parsed = modeDeclarationSchema.safeParse({
      id: "bad-package",
      layer: "package/kernel",
      title: "Bad",
      experimental: false,
      packages: ["not a package"],
    });
    expect(parsed.success).toBe(false);
  });

  it("resolves docker into packages, the kernel fragment, the data root and a uci-defaults file", () => {
    const result = resolve({
      overlays: [{ id: "docker", layer: "kernel/config" }],
      engine: "source",
    });

    expect(result.issues).toEqual([]);
    expect(result.conflicts).toEqual([]);
    expect(result.packages).toEqual(expect.arrayContaining(["docker", "dockerd"]));
    expect(result.kernelConfig).toEqual(expect.arrayContaining(["CONFIG_OVERLAY_FS=y"]));
    expect(result.docker).toEqual({ dataRoot: "/var/lib/docker" });

    const file = result.files.find((item) => item.path === `files${DOCKER_UCI_PATH}`);
    expect(file?.mode).toBe(0o755);
    expect(file?.content).toContain("mkdir -p /var/lib/docker");
    // spec:42 wants /var/lib/docker, not the stock /opt/docker data root.
    expect(file?.content).toContain("uci -q set dockerd.globals.data_root='/var/lib/docker'");
    expect(file?.content).not.toMatch(/docker run|curl|wget/);
    expect(result.state.generatedFiles).toContain(DOCKER_UCI_PATH);
  });

  it("keeps the docker file, fragment and data root out of plans without the mode", () => {
    const result = resolve({ engine: "source" });

    expect(result.files.find((item) => item.path === `files${DOCKER_UCI_PATH}`)).toBeUndefined();
    expect(result.packages).toEqual([]);
    expect(result.kernelConfig).toEqual([]);
    expect(result.docker).toBeUndefined();
  });

  it("names a selected package that a mode package set conflicts with", () => {
    const result = resolve({
      overlays: [{ id: "docker", layer: "kernel/config" }],
      engine: "source",
      packages: ["podman"],
    });

    expect(result.issues).toEqual([]);
    const message = result.conflicts.map((conflict) => conflict.message).join("\n");
    expect(message).toMatch(/docker/);
    expect(message).toMatch(/podman/);
  });

  it("keeps the NAS package set free of disk operations", () => {
    const result = resolve({ overlays: [{ id: "nas", layer: "package/kernel" }] });

    expect(result.issues).toEqual([]);
    expect(result.conflicts).toEqual([]);
    expect(result.packages).toEqual(expect.arrayContaining(["samba4-server"]));
    for (const file of result.files) {
      expect(file.content).not.toMatch(/mkfs|fdisk|parted|mount\b|blkid/);
    }
  });
});
