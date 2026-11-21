import { describe, expect, it } from "vitest";
import { loadModeDeclarations } from "./modes";
import { modeBlockingReasons, modeSelectable, requirementLabel } from "./mode-ui";
import type { ModeOption } from "./ui-types";

const declarations = loadModeDeclarations();

function mode(id: string): ModeOption {
  const declaration = declarations.find((entry) => entry.id === id)!;
  return {
    id,
    title: declaration.title,
    description: declaration.description ?? null,
    layer: declaration.layer,
    experimental: declaration.experimental,
    network: declaration.network ?? null,
    packages: [...(declaration.packages ?? [])],
    requires: [...(declaration.requires ?? [])],
    requiresAny: (declaration.requiresAny ?? []).map((group) => [...group]),
    conflicts: [...(declaration.conflicts ?? [])],
    exclusiveGroup: declaration.exclusiveGroup ?? null,
    offered: true,
    disabledReason: null,
  };
}

const all = declarations.map((declaration) => mode(declaration.id));

function context(overrides: Partial<Parameters<typeof modeBlockingReasons>[1]> = {}) {
  return {
    engine: "imagebuilder" as const,
    filesystem: "ext4" as const,
    artifact: "combined" as const,
    capabilities: ["efi", "legacy", "ext4", "squashfs", "combined", "overlay"],
    basePresetFeatures: [],
    selectedModeIds: [],
    selectedPackages: [],
    ...overrides,
  };
}

describe("modeBlockingReasons", () => {
  it("explains that Docker needs the source engine", () => {
    const reasons = modeBlockingReasons(mode("docker"), context(), all);
    expect(reasons).toContain("需要源码构建引擎");
    expect(modeSelectable(mode("docker"), context(), all)).toBe(false);
    expect(
      modeSelectable(mode("docker"), context({ engine: "source" }), all),
    ).toBe(true);
  });

  it("reports a missing capability requirement", () => {
    const reasons = modeBlockingReasons(mode("wifi"), context(), all);
    expect(reasons.join(" ")).toContain("需要以下之一");
    expect(reasons.join(" ")).toContain("能力 radio");
  });

  it("allows wifi once the usb-wifi overlay is selected", () => {
    const ctx = context({ selectedModeIds: ["usb-wifi"] });
    expect(modeBlockingReasons(mode("wifi"), ctx, all)).toEqual([]);
  });

  it("rejects two modes in the same exclusive group", () => {
    const reasons = modeBlockingReasons(mode("wan-eth0"), context({ selectedModeIds: ["switch-port"] }), all);
    expect(reasons.join(" ")).toContain("互斥");
    expect(reasons.join(" ")).toContain("Switch port mapping");
  });

  it("detects base preset conflicts and package conflicts", () => {
    const bypass = modeBlockingReasons(
      mode("bypass"),
      context({ basePresetFeatures: ["feature:dhcp-server"], selectedPackages: [] }),
      all,
    );
    expect(bypass.join(" ")).toContain("LAN DHCP");
    const docker = modeBlockingReasons(
      mode("docker"),
      context({ engine: "source", selectedPackages: ["podman"] }),
      all,
    );
    expect(docker.join(" ")).toContain("软件包 podman");
  });
});

describe("requirementLabel", () => {
  it("localizes planner tokens", () => {
    expect(requirementLabel("engine:source")).toBe("源码构建引擎");
    expect(requirementLabel("capability:radio")).toBe("能力 radio");
    expect(requirementLabel("mode:usb-wifi")).toBe("模式 usb-wifi");
    expect(requirementLabel("package:podman")).toBe("软件包 podman");
    expect(requirementLabel("unknown:token")).toBe("unknown:token");
  });
});
