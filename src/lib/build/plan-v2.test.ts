import { describe, expect, it } from "vitest";
import { readBuildPlan } from "../domain/build-plan";
import type { SourcePins } from "../catalog/types";
import { createSourceRegistry } from "../sources/registry";
import { createBuildPlan } from "./plan";
import { DLLKIDS_WRAPPER_PATH, IMAGE_FEED_LIST_PATH, feedPlanPath } from "./feeds";
import { parseCommonPreset } from "../presets/common";
import { DOCKER_UCI_PATH } from "./modes";
import { createBuildPlanV2, type PlanV2Context, type PlanV2Success } from "./plan-v2";
import type { BuildFormInput, BuildFormInputV2, PackageLookup, PackageLookupEntry } from "./types";

function entry(name: string, overrides: Partial<PackageLookupEntry> = {}): PackageLookupEntry {
  return {
    version: "1",
    depends: [],
    source: "official",
    sourcePin: "",
    sha256: null,
    filename: `${name}-1.apk`,
    downloadUrl: null,
    feed: "packages",
    license: "MIT",
    proprietary: false,
    ...overrides,
  };
}

const official: Record<string, PackageLookupEntry> = {
  luci: entry("luci", { depends: ["luci-base"], feed: "luci" }),
  "luci-base": entry("luci-base", { depends: ["libc"] }),
  libc: entry("libc"),
  "luci-app-demo": entry("luci-app-demo"),
  "vendor-app": entry("vendor-app", { license: "Proprietary", proprietary: true }),
  // Docker mode package set (ticket 08) and one curated-package fixture.
  docker: entry("docker"),
  dockerd: entry("dockerd"),
  containerd: entry("containerd"),
  runc: entry("runc"),
  tini: entry("tini"),
  "ca-bundle": entry("ca-bundle"),
  "kmod-veth": entry("kmod-veth"),
  "kmod-br-netfilter": entry("kmod-br-netfilter"),
  "kmod-ipt-nat": entry("kmod-ipt-nat"),
  "iptables-nft": entry("iptables-nft"),
  "demo-restricted": entry("demo-restricted"),
  podman: entry("podman"),
};
const lookup: PackageLookup = (name) => official[name] ?? null;

const dllkidsLucky = entry("lucky", {
  version: "3.5.0-r1",
  source: "dllkids",
  sourcePin: "idx-sha",
  sha256: "b925d2f2e604f834f25f9170eba75700479fc4a48bd1f42efe4749bc5b2c7636",
  filename: "lucky-3.5.0-r1.apk",
  downloadUrl: "https://down.dllkids.xyz/openwrt-feed/25.12/x86_64/lucky-3.5.0-r1.apk",
  feed: "dllkids",
});

function lookupAll(name: string): PackageLookupEntry[] {
  if (name === "lucky") return [dllkidsLucky];
  return official[name] ? [official[name]] : [];
}

const pins: SourcePins = {
  official: { luci: "", packages: "" },
  dllkids: "idx-sha",
  supplement: null,
  kernel: null,
};

const catalogProfiles: PlanV2Context["catalogProfiles"] = [
  { id: "generic", title: "Generic x86/64", formats: ["ext4-efi", "squashfs-efi", "rootfs-tar"], imageCount: 25 },
];

function formV2(overrides: Partial<BuildFormInputV2> = {}): BuildFormInputV2 {
  return {
    profile: "generic",
    target: "x86/64",
    kernelLine: "6.12",
    imageVariant: { boot: "efi", filesystem: "ext4", artifact: "combined" },
    hostname: "router",
    timezone: "Asia/Shanghai",
    lanIp: "192.168.5.1",
    netmask: "255.255.255.0",
    rootPassword: "correct horse",
    packages: ["luci-app-demo"],
    ...overrides,
  };
}

function contextV2(overrides: Partial<PlanV2Context> = {}): PlanV2Context {
  return {
    baseVersion: "25.12.2",
    channel: "release",
    feedCommit: "abc123",
    sourceNote: "fixture",
    sourcePins: pins,
    catalogProfiles,
    lookup,
    lookupAll,
    hashPassword: async () => "$6$hash",
    now: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function planned(outcome: Awaited<ReturnType<typeof createBuildPlanV2>>): PlanV2Success {
  expect(outcome.ok).toBe(true);
  if (!outcome.ok) throw new Error(outcome.issues.join("; "));
  return outcome;
}

function planOf(outcome: Awaited<ReturnType<typeof createBuildPlanV2>>) {
  return planned(outcome).plan;
}

function resolved(plan: ReturnType<typeof planOf>, name: string) {
  const found = plan.resolved.find((item) => item.name === name);
  expect(found).toBeDefined();
  return found!;
}

describe("createBuildPlanV2", () => {
  it("emits a schemaVersion 2 plan carrying target, kernel line, variant, engine and visibility", async () => {
    const plan = planOf(await createBuildPlanV2(formV2({ visibility: "public" }), contextV2()));

    expect(plan.schemaVersion).toBe(2);
    expect(plan.target.id).toBe("x86/64");
    expect(plan.deviceProfile.id).toBe("generic");
    expect(plan.kernelLine).toMatchObject({ id: "6.12", version: "6.12", engine: "imagebuilder" });
    expect(plan.imageVariant).toEqual({ boot: "efi", filesystem: "ext4", artifact: "combined", overlaySizeMb: 1024 });
    expect(plan.engine).toBe("imagebuilder");
    expect(plan.visibility).toBe("public");
    expect(plan.basePreset).toEqual({ id: "minimal", layer: "file/board" });
    expect(plan.overlays).toEqual([]);
    expect(plan.imageType).toBe("ext4-efi");
    expect(plan.modes?.basePreset).toMatchObject({ id: "minimal", title: "Minimal" });
    expect(plan.modes?.overlays).toEqual([]);
    expect(plan.modes?.network.wan).toMatchObject({ protocol: "dhcp", device: "default" });
    expect(plan.modes?.network.lan.dhcp.enabled).toBe(true);
  });

  it("marks a V2 plan writable and a V1 plan read-only when read back", async () => {
    const v2 = planOf(await createBuildPlanV2(formV2(), contextV2()));
    const v1 = await createBuildPlan(
      (() => {
        const { target, kernelLine, imageVariant, modes, basePreset, ...v1Form } = formV2();
        void target;
        void kernelLine;
        void imageVariant;
        void modes;
        void basePreset;
        return { ...v1Form, imageType: "ext4-efi" } as BuildFormInput;
      })(),
      {
        baseVersion: "25.12.2",
        feedCommit: "abc123",
        sourceNote: "fixture",
        sourcePins: pins,
        profile: catalogProfiles[0]!,
        lookup,
        lookupAll,
        hashPassword: async () => "$6$hash",
      },
    );

    expect(readBuildPlan(v2)).toMatchObject({ schemaVersion: 2, readOnly: false });
    expect(readBuildPlan(v1)).toMatchObject({ schemaVersion: 1, readOnly: true });
    expect(readBuildPlan(v1).plan).not.toHaveProperty("schemaVersion");
  });

  it("keeps the V1 artifact name for the canonical efi/ext4/combined variant", async () => {
    const plan = planOf(await createBuildPlanV2(formV2(), contextV2()));

    expect(plan.artifactName).toBe("immortalwrt-25.12.2-x86-64-generic-ext4-combined-efi.img.gz");
  });

  it("names every other artifact from target, profile, boot, filesystem and artifact", async () => {
    const cases: Array<[BuildFormInputV2["imageVariant"], string]> = [
      [
        { boot: "legacy", filesystem: "squashfs", artifact: "combined" },
        "immortalwrt-25.12.2-x86-64-generic-squashfs-combined.img.gz",
      ],
      [
        { boot: "efi", filesystem: "squashfs", artifact: "rootfs" },
        "immortalwrt-25.12.2-x86-64-generic-targz-rootfs.tar.gz",
      ],
      [
        { boot: "efi", filesystem: "ext4", artifact: "vmdk" },
        "immortalwrt-25.12.2-x86-64-generic-ext4-combined-efi.vmdk",
      ],
      [
        { boot: "legacy", filesystem: "ext4", artifact: "qcow2" },
        "immortalwrt-25.12.2-x86-64-generic-ext4-combined.qcow2",
      ],
    ];

    for (const [imageVariant, expected] of cases) {
      const plan = planOf(await createBuildPlanV2(formV2({ imageVariant }), contextV2()));
      expect(plan.artifactName).toBe(expected);
    }
  });

  it("lets the kernel line decide the engine", async () => {
    const plan = planOf(await createBuildPlanV2(formV2({ kernelLine: "6.6" }), contextV2()));

    expect(plan.engine).toBe("source");
    expect(plan.kernelLine).toMatchObject({ id: "6.6", engine: "source", sourceRecipeRef: "config/kernel/6.6.config" });
  });

  it("rejects an unmodelled kernel line with a readable 409", async () => {
    const outcome = await createBuildPlanV2(formV2({ kernelLine: "5.15" }), contextV2());

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe(409);
    expect(outcome.issues.join("\n")).toMatch(/kernel line "5\.15"/i);
  });

  it("rejects a variant the capability registry declares unsupported", async () => {
    const outcome = await createBuildPlanV2(
      formV2({ imageVariant: { boot: "efi", filesystem: "ext4", artifact: "emmc" } }),
      contextV2(),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe(400);
    expect(outcome.issues.join("\n")).toMatch(/emmc/);
    expect(outcome.issues.join("\n")).toMatch(/not supported/);
  });

  it("rejects a placeholder target profile", async () => {
    const outcome = await createBuildPlanV2(
      formV2({ target: "mediatek/filogic" }),
      contextV2({ catalogProfiles: [] }),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe(400);
    expect(outcome.issues.join("\n")).toMatch(/mediatek\/filogic/);
    expect(outcome.issues.join("\n")).toMatch(/not buildable/);
  });

  it("rejects unknown targets and profiles without building a plan", async () => {
    const unknownTarget = await createBuildPlanV2(formV2({ target: "x86/32" }), contextV2());
    const unknownProfile = await createBuildPlanV2(formV2({ profile: "tiny" }), contextV2());

    expect(unknownTarget.ok).toBe(false);
    expect(unknownProfile.ok).toBe(false);
    if (unknownTarget.ok || unknownProfile.ok) return;
    expect(unknownTarget.issues.join("\n")).toMatch(/x86\/32/);
    expect(unknownProfile.issues.join("\n")).toMatch(/tiny/);
  });

  it("rejects overlay sizes below the declared range and applies the default when absent", async () => {
    const zero = await createBuildPlanV2(
      formV2({ imageVariant: { boot: "efi", filesystem: "ext4", artifact: "combined", overlaySizeMb: 0 } }),
      contextV2(),
    );
    const tooLarge = await createBuildPlanV2(
      formV2({ imageVariant: { boot: "efi", filesystem: "ext4", artifact: "combined", overlaySizeMb: 20_000 } }),
      contextV2(),
    );
    const missing = planOf(await createBuildPlanV2(formV2(), contextV2()));

    expect(zero.ok).toBe(false);
    expect(tooLarge.ok).toBe(false);
    if (!zero.ok) expect(zero.issues.join("\n")).toMatch(/overlay size 0/i);
    if (!tooLarge.ok) expect(tooLarge.issues.join("\n")).toMatch(/20000/);
    expect(missing.imageVariant.overlaySizeMb).toBe(1024);
  });

  it("leaves the overlay off a rootfs tarball", async () => {
    const plan = planOf(
      await createBuildPlanV2(
        formV2({ imageVariant: { boot: "efi", filesystem: "squashfs", artifact: "rootfs" } }),
        contextV2(),
      ),
    );

    expect(plan.imageVariant.overlaySizeMb).toBeUndefined();
    expect(plan.imageType).toBe("rootfs-tar");
  });

  it("stacks requested modes on an explicit base preset", async () => {
    const plan = planOf(
      await createBuildPlanV2(
        formV2({
          kernelLine: "6.6",
          basePreset: "common",
          modes: [{ id: "docker", layer: "package/kernel" }],
        }),
        contextV2(),
      ),
    );

    expect(plan.basePreset).toEqual({ id: "common", layer: "file/board" });
    expect(plan.overlays).toEqual([{ id: "docker", layer: "package/kernel" }]);
  });

  it("writes the controlled mode file only for plans that change the network", async () => {
    const plain = planOf(await createBuildPlanV2(formV2(), contextV2()));
    expect(plain.files.map((file) => file.path)).toEqual([
      "files/etc/uci-defaults/99-combinewrt",
      feedPlanPath(IMAGE_FEED_LIST_PATH),
      feedPlanPath(DLLKIDS_WRAPPER_PATH),
    ]);

    const routed = planOf(
      await createBuildPlanV2(
        formV2({ basePreset: "router-default", modes: [{ id: "ipv6", layer: "file/board" }] }),
        contextV2(),
      ),
    );
    const modeFile = routed.files.find((file) => file.path === "files/etc/uci-defaults/90-combinewrt-modes");
    expect(modeFile?.mode).toBe(0o755);
    expect(modeFile?.content).toContain("uci set network.wan6.proto='dhcpv6'");
    expect(routed.modes?.generatedFiles).toContain("/etc/uci-defaults/90-combinewrt-modes");
  });

  it("attaches a public feed set with no default dllkids repository", async () => {
    const plan = planOf(await createBuildPlanV2(formV2({ visibility: "public" }), contextV2()));

    expect(plan.feedSet?.visibility).toBe("public");
    expect(plan.feedSet?.repositories.map((repository) => repository.id)).toEqual([
      "official",
      "supplement",
    ]);
    expect(plan.files.map((file) => file.path)).not.toContain(feedPlanPath(DLLKIDS_WRAPPER_PATH));
    expect(JSON.stringify(plan.feedSet)).not.toContain("dllkids.xyz");
    expect(plan.preflight?.packages).toEqual(plan.packages);
    expect(plan.preflight?.allowUntrusted).toBe(false);
  });

  it("attaches a private feed set with the explicit dllkids wrapper", async () => {
    const plan = planOf(await createBuildPlanV2(formV2(), contextV2()));

    expect(plan.feedSet?.visibility).toBe("private");
    expect(plan.feedSet?.repositories.map((repository) => repository.id)).toEqual([
      "official",
      "supplement",
      "dllkids",
    ]);
    const wrapper = plan.files.find((file) => file.path === feedPlanPath(DLLKIDS_WRAPPER_PATH));
    expect(wrapper?.mode).toBe(0o755);
    expect(wrapper?.content).toContain("apk --allow-untrusted");
    expect(plan.preflight?.repositories.join("\n")).not.toContain("dllkids.xyz");
  });

  it("records the actually used mirror in the feed set", async () => {
    const mirror = "https://mirror.example.test/immortalwrt";
    const plan = planOf(
      await createBuildPlanV2(
        formV2({ visibility: "public" }),
        contextV2({ feedOptions: { officialBaseUrl: mirror, officialMirror: mirror } }),
      ),
    );

    expect(plan.feedSet?.officialMirror).toBe(mirror);
    expect(plan.feedSet?.officialBaseUrl).toBe(mirror);
    const list = plan.files.find((file) => file.path === feedPlanPath(IMAGE_FEED_LIST_PATH));
    expect(list?.content).toContain(mirror);
  });

  it("adds the extension feed only when an extension package resolves", async () => {
    const without = planOf(
      await createBuildPlanV2(formV2({ visibility: "public" }), contextV2()),
    );
    expect(without.feedSet?.repositories.map((repository) => repository.id)).not.toContain(
      "extension",
    );

    const withExtension = planOf(
      await createBuildPlanV2(
        formV2({ visibility: "public" }),
        contextV2({
          lookup: (name) => entry(name, { source: "extension" as PackageLookupEntry["source"] }),
        }),
      ),
    );
    expect(withExtension.feedSet?.repositories.map((repository) => repository.id)).toContain(
      "extension",
    );
  });

  it("turns an unmet mode requirement into a 409-grade conflict", async () => {
    const outcome = planned(
      await createBuildPlanV2(
        formV2({
          kernelLine: "6.6",
          imageVariant: { boot: "efi", filesystem: "squashfs", artifact: "combined" },
          modes: [{ id: "docker", layer: "kernel/config" }],
        }),
        contextV2(),
      ),
    );
    const message = outcome.conflicts.map((conflict) => conflict.message).join("\n");
    expect(message).toMatch(/docker/);
    expect(message).toMatch(/ext4/);
  });

  it("rejects typed network input the planner cannot honour", async () => {
    const outcome = await createBuildPlanV2(
      formV2({ network: { lan: { dhcp: { enabled: true, start: 250, limit: 10 } } } }),
      contextV2(),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe(400);
    expect(outcome.issues.join("\n")).toMatch(/pool runs past/);
  });

  it("reports a mode the kernel line cannot run as a 409-grade conflict naming the requirement", async () => {
    const outcome = planned(
      await createBuildPlanV2(
        formV2({ modes: [{ id: "docker", layer: "kernel/config" }] }),
        contextV2(),
      ),
    );
    const message = outcome.conflicts.map((conflict) => conflict.message).join("\n");

    expect(message).toMatch(/docker/);
    expect(message).toMatch(/source engine/);
  });

  it("rejects a mode the profile does not offer", async () => {
    const outcome = await createBuildPlanV2(
      formV2({ modes: [{ id: "no-such-mode", layer: "package/kernel" }] }),
      contextV2(),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.issues.join("\n")).toMatch(/no-such-mode/);
  });

  it("keeps the V1 public-image gate for V2 plans", async () => {
    const outcome = planned(
      await createBuildPlanV2(formV2({ visibility: "public", packages: ["vendor-app"] }), contextV2()),
    );

    expect(outcome.plan.visibility).toBe("public");
    expect(outcome.conflicts).toHaveLength(1);
    expect(outcome.conflicts[0]?.message).toMatch(/vendor-app/);
    expect(outcome.conflicts[0]?.message).toMatch(/official/);
  });

  it("records a strategy and a source pin for every resolved package, dependencies included", async () => {
    const outcome = planned(await createBuildPlanV2(formV2({ packages: ["luci"] }), contextV2()));

    expect(outcome.plan.resolved.length).toBeGreaterThan(1);
    for (const item of outcome.plan.resolved) {
      expect(["prebuilt", "rebuild", "blocked"]).toContain(item.requestedStrategy);
      expect(["prebuilt", "rebuild", "blocked"]).toContain(item.effectiveStrategy);
      expect(item).toHaveProperty("sourcePin");
    }
  });

  it("keeps V1 catalog sources as prebuilt when no source registry is loaded", async () => {
    const outcome = planned(await createBuildPlanV2(formV2({ packages: ["luci"] }), contextV2()));

    expect(outcome.conflicts).toEqual([]);
    expect(resolved(outcome.plan, "luci")).toMatchObject({
      requestedStrategy: "prebuilt",
      effectiveStrategy: "prebuilt",
    });
  });

  it("falls back from prebuilt to rebuild and records the reason", async () => {
    const registry = createSourceRegistry([
      {
        name: "lucky",
        source: "dllkids",
        pin: "idx-sha",
        license: "GPL-2.0-only",
        publicAllowed: true,
        targets: ["mips/mt7621"],
        strategy: "prebuilt",
        recipe: "package/lucky",
      },
    ]);
    const outcome = planned(
      await createBuildPlanV2(formV2({ packages: ["lucky"] }), contextV2({ sources: registry })),
    );

    expect(resolved(outcome.plan, "lucky")).toMatchObject({
      requestedStrategy: "prebuilt",
      effectiveStrategy: "rebuild",
      fallbackReason: expect.stringMatching(/mips\/mt7621/),
    });
    expect(outcome.conflicts).toEqual([]);
  });

  it("falls back when the pinned prebuilt was compiled for another kernel ABI", async () => {
    const registry = createSourceRegistry([
      {
        name: "luci",
        source: "official",
        pin: "feed-sha",
        license: "MIT",
        publicAllowed: true,
        strategy: "prebuilt",
        recipe: "package/luci",
        abi: "6.12.103-1-aaaa",
      },
    ]);
    const withAbi = planned(
      await createBuildPlanV2(formV2({ packages: ["luci"] }), contextV2({ sources: registry, sourcePins: { ...pins, kernel: { version: "6.12.103", release: "1", vermagic: "6.12.103-1-bbbb" } } })),
    );

    expect(resolved(withAbi.plan, "luci")).toMatchObject({
      requestedStrategy: "prebuilt",
      effectiveStrategy: "rebuild",
      fallbackReason: expect.stringMatching(/ABI/),
    });
  });

  it("names the package and source in a 409-grade conflict when no recipe exists", async () => {
    const registry = createSourceRegistry([
      {
        name: "lucky",
        source: "dllkids",
        pin: "idx-sha",
        license: "GPL-2.0-only",
        publicAllowed: true,
        targets: ["mips/mt7621"],
        strategy: "prebuilt",
        recipe: null,
      },
    ]);
    const outcome = planned(
      await createBuildPlanV2(formV2({ packages: ["lucky"] }), contextV2({ sources: registry })),
    );

    const blocked = resolved(outcome.plan, "lucky");
    expect(blocked.effectiveStrategy).toBe("blocked");
    expect(blocked.fallbackReason).toMatch(/no source recipe/);
    expect(outcome.conflicts.map((conflict) => conflict.message).join("\n")).toMatch(/lucky/);
    expect(outcome.conflicts.map((conflict) => conflict.message).join("\n")).toMatch(/dllkids/);
  });

  it("blocks a package that has no catalog source at all and says so", async () => {
    const outcome = planned(await createBuildPlanV2(formV2({ packages: ["ghost"] }), contextV2()));

    expect(resolved(outcome.plan, "ghost")).toMatchObject({
      packageSource: null,
      effectiveStrategy: "blocked",
    });
    expect(outcome.conflicts.map((conflict) => conflict.message).join("\n")).toMatch(/ghost/);
    expect(outcome.conflicts.map((conflict) => conflict.message).join("\n")).toMatch(/unknown/);
  });

  it("honours a registry that blocks a package outright", async () => {
    const registry = createSourceRegistry([
      { name: "vendor-app", source: "official", strategy: "blocked", license: "Proprietary" },
    ]);
    const outcome = planned(
      await createBuildPlanV2(formV2({ packages: ["vendor-app"] }), contextV2({ sources: registry })),
    );

    expect(resolved(outcome.plan, "vendor-app").effectiveStrategy).toBe("blocked");
    expect(outcome.conflicts.map((conflict) => conflict.message).join("\n")).toMatch(/blocked/);
  });
});

describe("packages, removals and curated common packages (ticket 08)", () => {
  const commonPreset = parseCommonPreset({
    schemaVersion: 1,
    groups: [
      {
        id: "apps",
        title: "应用",
        packages: [
          { name: "luci-app-demo", source: "official", license: "MIT", description: "演示应用" },
          {
            name: "demo-restricted",
            source: "official",
            license: "MIT",
            description: "仅限联发科目标的演示包",
            targets: ["mediatek/filogic"],
          },
        ],
      },
    ],
  });

  it("carries the docker package set, kernel fragment, data root and writable file into a source plan", async () => {
    const plan = planOf(
      await createBuildPlanV2(
        formV2({
          kernelLine: "6.6",
          modes: [{ id: "docker", layer: "kernel/config" }],
        }),
        contextV2(),
      ),
    );

    expect(plan.engine).toBe("source");
    expect(plan.conflicts).toEqual([]);
    expect(plan.packages).toEqual(expect.arrayContaining(["docker", "dockerd", "containerd", "runc"]));
    expect(plan.kernelConfig).toEqual(expect.arrayContaining(["CONFIG_OVERLAY_FS=y"]));
    expect(plan.docker).toEqual({ dataRoot: "/var/lib/docker" });
    const file = plan.files.find((item) => item.path === `files${DOCKER_UCI_PATH}`);
    expect(file?.content).toContain("mkdir -p /var/lib/docker");
  });

  it("names the filesystem requirement docker needs when the plan is squashfs", async () => {
    const outcome = planned(
      await createBuildPlanV2(
        formV2({
          kernelLine: "6.6",
          imageVariant: { boot: "efi", filesystem: "squashfs", artifact: "combined" },
          modes: [{ id: "docker", layer: "kernel/config" }],
        }),
        contextV2(),
      ),
    );
    const message = outcome.conflicts.map((conflict) => conflict.message).join("\n");

    expect(message).toMatch(/docker/);
    expect(message).toMatch(/ext4/);
  });

  it("names the source engine requirement when an ImageBuilder plan asks for docker", async () => {
    const outcome = planned(
      await createBuildPlanV2(
        formV2({ modes: [{ id: "docker", layer: "kernel/config" }] }),
        contextV2(),
      ),
    );
    const message = outcome.conflicts.map((conflict) => conflict.message).join("\n");

    expect(message).toMatch(/docker/);
    expect(message).toMatch(/source engine/);
  });

  it("removes a selected package through the negative list", async () => {
    const plan = planOf(
      await createBuildPlanV2(
        formV2({ packages: ["luci-app-demo", "luci"], removePackages: ["luci-app-demo"] }),
        contextV2(),
      ),
    );

    expect(plan.packages).not.toContain("luci-app-demo");
    expect(plan.packages).toContain("luci");
    expect(plan.conflicts).toEqual([]);
  });

  it("refuses to remove an essential package and names it", async () => {
    const outcome = planned(
      await createBuildPlanV2(formV2({ removePackages: ["libc"] }), contextV2()),
    );

    expect(outcome.conflicts.some((conflict) => conflict.names.includes("libc"))).toBe(true);
    expect(outcome.conflicts.map((conflict) => conflict.message).join("\n")).toMatch(/基础包|essentials/);
  });

  it("warns instead of failing when the removed package is absent", async () => {
    const plan = planOf(await createBuildPlanV2(formV2({ removePackages: ["ghost"] }), contextV2()));

    expect(plan.conflicts).toEqual([]);
    expect((plan.warnings ?? []).join("\n")).toMatch(/ghost/);
  });

  it("names a curated package that is out of range for the selected target", async () => {
    const outcome = planned(
      await createBuildPlanV2(
        formV2({ packages: ["demo-restricted"] }),
        contextV2({ commonPreset }),
      ),
    );
    const conflict = outcome.conflicts.find((item) => item.names.includes("demo-restricted"));

    expect(conflict).toBeDefined();
    expect(conflict?.message).toMatch(/mediatek\/filogic/);
    expect(conflict?.message).toMatch(/official/);
  });

  it("names a curated package whose catalog source disagrees with the curated source", async () => {
    const preset = parseCommonPreset({
      schemaVersion: 1,
      groups: [
        {
          id: "apps",
          title: "应用",
          packages: [
            {
              name: "demo-restricted",
              source: "dllkids",
              license: "MIT",
              description: "来源与目录不一致的演示包",
            },
          ],
        },
      ],
    });
    const outcome = planned(
      await createBuildPlanV2(
        formV2({ packages: ["demo-restricted"] }),
        contextV2({ commonPreset: preset }),
      ),
    );
    const message = outcome.conflicts.map((conflict) => conflict.message).join("\n");

    expect(message).toMatch(/official/);
    expect(message).toMatch(/dllkids/);
  });

  it("names a mode and a selected package when the mode conflicts with it", async () => {
    const outcome = planned(
      await createBuildPlanV2(
        formV2({
          kernelLine: "6.6",
          packages: ["podman"],
          modes: [{ id: "docker", layer: "kernel/config" }],
        }),
        contextV2(),
      ),
    );
    const message = outcome.conflicts.map((conflict) => conflict.message).join("\n");

    expect(message).toMatch(/docker/);
    expect(message).toMatch(/podman/);
  });
});
