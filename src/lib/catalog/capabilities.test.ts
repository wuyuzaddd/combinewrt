import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type {
  ArtifactKind,
  BootMode,
  FilesystemKind,
  ImageVariant,
  KernelLine,
} from "../domain/types";
import {
  CapabilityError,
  capabilitiesFilePath,
  getKernelLine,
  getProfile,
  getTarget,
  loadCapabilities,
  supportsMode,
  supportsVariant,
  validateCapabilities,
  type CapabilityRegistry,
} from "./capabilities";

const UPSTREAM_FIXTURE = new URL("./fixtures/profiles-x86-64.json", import.meta.url);
const REGISTRY_FIXTURE = new URL("../../../config/capabilities/targets.json", import.meta.url);

interface MutableVariant {
  boot: BootMode;
  filesystem: FilesystemKind;
  artifact: ArtifactKind;
  supported: boolean;
  experimental: boolean;
  verifiedBy: string;
  notes?: string;
}

interface MutableProfile {
  id: string;
  title: string;
  status: string;
  capabilities: string[];
  overlay: { minMb: number; maxMb: number; stepMb: number; defaultMb: number };
  kernelLines: string[];
  modes: Array<{ id: string; experimental?: boolean }>;
  variants: MutableVariant[];
}

interface MutableTarget {
  id: string;
  architecture: string;
  subtarget: string;
  title: string;
  status: string;
  profiles: MutableProfile[];
}

interface MutableRegistry {
  schemaVersion: number;
  kernelLines: Array<Record<string, unknown>>;
  modes: Array<Record<string, unknown>>;
  targets: MutableTarget[];
}

function mutableRegistry(): MutableRegistry {
  return JSON.parse(readFileSync(REGISTRY_FIXTURE, "utf8")) as MutableRegistry;
}

function x86Profile(registry: MutableRegistry): MutableProfile {
  const profile = registry.targets.find((target) => target.id === "x86/64")?.profiles[0];
  if (!profile) throw new Error("fixture registry has no x86/64 profile");
  return profile;
}

function variant(overrides: Partial<ImageVariant> = {}): ImageVariant {
  return { boot: "efi", filesystem: "ext4", artifact: "combined", ...overrides };
}

const profileRef = { targetId: "x86/64", id: "generic" };

const registry = loadCapabilities();
const x86 = getTarget("x86/64");
const generic = getProfile("x86/64", "generic");

describe("capability registry loader", () => {
  it("loads the checked-in registry from the repository config directory", () => {
    expect(capabilitiesFilePath()).toMatch(/config[/\\]capabilities[/\\]targets\.json$/);
    expect(registry.schemaVersion).toBe(1);
    expect(x86.architecture).toBe("x86_64");
    expect(generic.status).toBe("verified");
    expect(getKernelLine("6.12")).toMatchObject({ version: "6.12", engine: "imagebuilder", experimental: false });
  });

  it("returns the same parsed registry for repeated loads", () => {
    expect(loadCapabilities()).toBe(registry);
  });

  it("reports unknown targets, profiles and kernel lines with readable errors", () => {
    expect(() => getTarget("mips/24kc")).toThrow(CapabilityError);
    expect(() => getProfile("x86/64", "does-not-exist")).toThrow(CapabilityError);
    expect(() => getKernelLine("5.15")).toThrow(CapabilityError);

    try {
      getTarget("mips/24kc");
    } catch (error) {
      const failure = error as CapabilityError;
      expect(failure.code).toBe("unknown-target");
      expect(failure.message).toContain("mips/24kc");
      expect(failure.message).toContain("x86/64");
    }

    try {
      getProfile("x86/64", "does-not-exist");
    } catch (error) {
      const failure = error as CapabilityError;
      expect(failure.code).toBe("unknown-profile");
      expect(failure.message).toContain("does-not-exist");
      expect(failure.message).toContain("generic");
    }
  });

  it("only advertises x86/64 generic as a buildable V2.0 target", () => {
    const buildable = registry.targets
      .filter((target) => target.status === "verified")
      .flatMap((target) => target.profiles.map((profile) => `${target.id}:${profile.id}`));
    expect(buildable).toEqual(["x86/64:generic"]);

    const arm = getTarget("mediatek/filogic");
    expect(arm.status).toBe("placeholder");
    expect(arm.profiles[0].status).toBe("placeholder");
  });
});

describe("x86/64 generic capability declarations", () => {
  it("declares every V2.0 boot/filesystem/artifact combination", () => {
    for (const boot of ["efi", "legacy"] as const) {
      for (const filesystem of ["ext4", "squashfs"] as const) {
        for (const artifact of ["combined", "rootfs", "vmdk", "qcow2"] as const) {
          expect(
            generic.variants.some(
              (entry) =>
                entry.boot === boot &&
                entry.filesystem === filesystem &&
                entry.artifact === artifact &&
                entry.supported,
            ),
            `${boot}/${filesystem}/${artifact} must be supported`,
          ).toBe(true);
        }
      }
    }
  });

  it("marks eMMC unsupported and experimental instead of promising a V2.0 artifact", () => {
    const emmc = generic.variants.filter((entry) => entry.artifact === "emmc");
    expect(emmc).toHaveLength(4);
    for (const entry of emmc) {
      expect(entry.supported).toBe(false);
      expect(entry.experimental).toBe(true);
      expect(entry.verifiedBy).toMatch(/deferred/i);
    }
  });

  it("keeps every verifiedBy reference honest and non-empty", () => {
    for (const entry of generic.variants) {
      expect(entry.verifiedBy.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("x86/64 generic variants match upstream ImageBuilder image names", () => {
  const upstream = JSON.parse(readFileSync(UPSTREAM_FIXTURE, "utf8")) as {
    profiles: { generic: { images: Array<{ name: string }> } };
  };
  const names = upstream.profiles.generic.images.map((image) => image.name);

  it.each(["ext4", "squashfs"] as const)("maps %s combined/vmdk/qcow2 artifacts to upstream names", (filesystem) => {
    for (const boot of ["efi", "legacy"] as const) {
      const bootSuffix = boot === "efi" ? "-efi" : "";
      expect(names).toContain(
        `immortalwrt-25.12.2-x86-64-generic-${filesystem}-combined${bootSuffix}.img.gz`,
      );
      expect(names).toContain(`immortalwrt-25.12.2-x86-64-generic-${filesystem}-combined${bootSuffix}.vmdk`);
      expect(names).toContain(`immortalwrt-25.12.2-x86-64-generic-${filesystem}-combined${bootSuffix}.qcow2`);
    }
  });

  it("proves the rootfs tarball is boot independent", () => {
    expect(names).toContain("immortalwrt-25.12.2-x86-64-generic-targz-rootfs.tar.gz");
    for (const filesystem of ["ext4", "squashfs"] as const) {
      const boots = generic.variants
        .filter((entry) => entry.filesystem === filesystem && entry.artifact === "rootfs" && entry.supported)
        .map((entry) => entry.boot);
      expect(boots.sort()).toEqual(["efi", "legacy"]);
    }
  });
});

describe("supportsVariant", () => {
  it("accepts every supported V2.0 combination and marks experimental kernel lines", () => {
    for (const boot of ["efi", "legacy"] as const) {
      for (const filesystem of ["ext4", "squashfs"] as const) {
        for (const artifact of ["combined", "rootfs", "vmdk", "qcow2"] as const) {
          const support = supportsVariant(profileRef, "6.12", { boot, filesystem, artifact });
          expect(support.supported, `${boot}/${filesystem}/${artifact}`).toBe(true);
          expect(support.experimental).toBe(false);
        }
      }
    }

    const experimental = supportsVariant(profileRef, "6.18", variant());
    expect(experimental.supported).toBe(true);
    expect(experimental.experimental).toBe(true);
  });

  it("rejects eMMC with a typed reason that names the deferral", () => {
    const support = supportsVariant(profileRef, "6.12", variant({ artifact: "emmc" }));
    if (support.supported) throw new Error("eMMC must not be supported");
    expect(support.reason.code).toBe("variant-unsupported");
    expect(support.reason.message).toMatch(/eMMC/i);
    expect(support.reason.message).toMatch(/ARM/i);
  });

  it("rejects unknown profiles, kernel lines and undeclared variant combinations", () => {
    const unknownProfile = supportsVariant({ targetId: "x86/64", id: "nope" }, "6.12", variant());
    if (unknownProfile.supported) throw new Error("unknown profile must be rejected");
    expect(unknownProfile.reason.code).toBe("unknown-profile");

    const unknownLine = supportsVariant(profileRef, "5.15", variant());
    if (unknownLine.supported) throw new Error("unknown kernel line must be rejected");
    expect(unknownLine.reason.code).toBe("unknown-kernel-line");
    expect(unknownLine.reason.message).toContain("5.15");

    const undeclared = supportsVariant(profileRef, "6.12", variant({ boot: "uefi" as BootMode }));
    if (undeclared.supported) throw new Error("undeclared variant must be rejected");
    expect(undeclared.reason.code).toBe("variant-not-declared");
  });

  it("rejects a kernel line object whose engine/version disagrees with the registry", () => {
    const mismatched: KernelLine = { id: "6.12", version: "6.6", engine: "source" };
    const support = supportsVariant(profileRef, mismatched, variant());
    if (support.supported) throw new Error("mismatched kernel line must be rejected");
    expect(support.reason.code).toBe("kernel-line-mismatch");
  });

  it("rejects kernel lines a profile does not offer", () => {
    const custom = minimalRegistry();
    custom.targets[0].profiles[0].kernelLines = ["6.12"];
    const support = supportsVariant(profileRef, "6.6", variant(), custom);
    if (support.supported) throw new Error("unoffered kernel line must be rejected");
    expect(support.reason.code).toBe("kernel-line-not-offered");
  });

  it("validates overlay sizes against the declared range and artifact kind", () => {
    expect(supportsVariant(profileRef, "6.12", variant({ overlaySizeMb: 512 })).supported).toBe(true);

    for (const size of [0, 100, 20000, 1000]) {
      const support = supportsVariant(profileRef, "6.12", variant({ overlaySizeMb: size }));
      if (support.supported) throw new Error(`overlay ${size} must be rejected`);
      expect(support.reason.code).toBe("overlay-out-of-range");
      expect(support.reason.message).toContain(String(size));
    }

    const rootfs = supportsVariant(profileRef, "6.12", variant({ artifact: "rootfs", overlaySizeMb: 512 }));
    if (rootfs.supported) throw new Error("rootfs overlay must be rejected");
    expect(rootfs.reason.code).toBe("overlay-not-allowed");
  });

  it("rejects placeholder profiles as not buildable", () => {
    const support = supportsVariant({ targetId: "mediatek/filogic", id: "generic" }, "6.12", {
      boot: "efi",
      filesystem: "squashfs",
      artifact: "emmc",
    });
    if (support.supported) throw new Error("placeholder profile must not be buildable");
    expect(support.reason.code).toBe("profile-not-buildable");
  });
});

describe("supportsMode", () => {
  it("accepts declared modes and reports experimental ones", () => {
    expect(supportsMode(profileRef, "docker")).toMatchObject({ supported: true, experimental: false });
    expect(supportsMode(profileRef, "wifi")).toMatchObject({ supported: true, experimental: true });
  });

  it("returns typed reasons for unknown and unoffered modes", () => {
    const unknown = supportsMode(profileRef, "not-a-mode");
    if (unknown.supported) throw new Error("unknown mode must be rejected");
    expect(unknown.reason.code).toBe("unknown-mode");

    const custom = minimalRegistry();
    custom.targets[0].profiles[0].modes = [];
    const unoffered = supportsMode(profileRef, "docker", custom);
    if (unoffered.supported) throw new Error("unoffered mode must be rejected");
    expect(unoffered.reason.code).toBe("mode-not-offered");
  });

  it("does not offer modes on placeholder profiles", () => {
    const support = supportsMode({ targetId: "mediatek/filogic", id: "generic" }, "docker");
    if (support.supported) throw new Error("placeholder profile must not offer modes");
    expect(support.reason.code).toBe("profile-not-buildable");
  });
});

describe("validateCapabilities", () => {
  it("accepts the checked-in registry", () => {
    expect(validateCapabilities(mutableRegistry())).toEqual([]);
  });

  it("rejects a malformed schema and lists every schema issue", () => {
    const violations = validateCapabilities({ schemaVersion: 2, targets: "nope" });
    expect(violations.length).toBeGreaterThan(1);
    expect(violations.join("\n")).toMatch(/schemaVersion/i);
  });

  it("rejects duplicate variants", () => {
    const raw = mutableRegistry();
    const profile = x86Profile(raw);
    profile.variants.push({ ...profile.variants[0] });
    expect(validateCapabilities(raw).join("\n")).toMatch(/duplicate variant/i);
  });

  it("rejects unknown kernel lines", () => {
    const raw = mutableRegistry();
    x86Profile(raw).kernelLines.push("6.1");
    const report = validateCapabilities(raw).join("\n");
    expect(report).toMatch(/kernel line/i);
    expect(report).toContain("6.1");
  });

  it("rejects a target without profiles", () => {
    const raw = mutableRegistry();
    raw.targets[0].profiles = [];
    expect(validateCapabilities(raw).join("\n")).toMatch(/no profiles/i);
  });

  it("rejects illegal overlay declarations", () => {
    const raw = mutableRegistry();
    x86Profile(raw).overlay.maxMb = 128;
    expect(validateCapabilities(raw).join("\n")).toMatch(/overlay/i);
  });

  it("rejects references to modes that do not exist", () => {
    const raw = mutableRegistry();
    x86Profile(raw).modes.push({ id: "not-a-mode" });
    const report = validateCapabilities(raw).join("\n");
    expect(report).toMatch(/mode/i);
    expect(report).toContain("not-a-mode");
  });

  it("rejects duplicate target and profile ids", () => {
    const raw = mutableRegistry();
    raw.targets.push(structuredClone(raw.targets[0]));
    const report = validateCapabilities(raw).join("\n");
    expect(report).toMatch(/duplicate target/i);
  });

  it("rejects source kernel lines without a recipe reference", () => {
    const raw = mutableRegistry();
    delete raw.kernelLines[0].sourceRecipeRef;
    expect(validateCapabilities(raw).join("\n")).toMatch(/sourceRecipeRef/i);
  });

  it("rejects placeholder targets that claim verified profiles", () => {
    const raw = mutableRegistry();
    const arm = raw.targets[1];
    arm.profiles[0].status = "verified";
    expect(validateCapabilities(raw).join("\n")).toMatch(/placeholder/i);
  });
});

function minimalRegistry(): CapabilityRegistry {
  return {
    schemaVersion: 1,
    kernelLines: [
      { id: "6.6", version: "6.6", engine: "source", experimental: true, sourceRecipeRef: "config/kernel/6.6.config" },
      { id: "6.12", version: "6.12", engine: "imagebuilder", experimental: false },
    ],
    modes: [{ id: "docker", layer: "kernel/config", title: "Docker", experimental: false, requiresEngine: "source" }],
    targets: [
      {
        id: "x86/64",
        architecture: "x86_64",
        subtarget: "generic",
        title: "x86/64 (generic)",
        status: "verified",
        profiles: [
          {
            id: "generic",
            title: "Generic x86/64",
            status: "verified",
            capabilities: ["efi"],
            overlay: { minMb: 256, maxMb: 16384, stepMb: 256, defaultMb: 1024 },
            kernelLines: ["6.6", "6.12"],
            modes: [{ id: "docker" }],
            variants: [
              {
                boot: "efi",
                filesystem: "ext4",
                artifact: "combined",
                supported: true,
                experimental: false,
                verifiedBy: "src/lib/catalog/capabilities.test.ts: minimal fixture",
              },
            ],
          },
        ],
      },
    ],
  };
}
