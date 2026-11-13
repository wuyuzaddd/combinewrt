import { describe, expect, it } from "vitest";
import type { SourcePins } from "../catalog/types";
import { createBuildPlan } from "./plan";
import type { BuildFormInput, PackageLookup, PackageLookupEntry } from "./types";

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
  "luci-app-demo": entry("luci-app-demo", { version: "2", depends: ["luci"] }),
  "dnsmasq-full": entry("dnsmasq-full"),
  dnsmasq: entry("dnsmasq"),
};
const lookup: PackageLookup = (name) => official[name] ?? null;

const pins: SourcePins = {
  official: { luci: "", packages: "" },
  dllkids: "idx-sha",
  supplement: null,
  kernel: null,
};

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
  if (name === "kmod-demo") {
    return [{ ...entry("kmod-demo", { depends: [] }), source: "dllkids", sourcePin: "idx-sha", feed: "dllkids" }];
  }
  return official[name] ? [official[name]] : [];
}

function form(overrides: Partial<BuildFormInput> = {}): BuildFormInput {
  return {
    profile: "generic",
    imageType: "ext4-efi",
    hostname: "router",
    timezone: "Asia/Shanghai",
    lanIp: "192.168.5.1",
    netmask: "255.255.255.0",
    rootPassword: "correct horse",
    packages: ["luci-app-demo"],
    ...overrides,
  };
}

function context(overrides: Partial<Parameters<typeof createBuildPlan>[1]> = {}) {
  return {
    baseVersion: "25.12.2",
    feedCommit: "abc123",
    sourceNote: "fixture",
    sourcePins: pins,
    profile: { id: "generic", title: "Generic x86/64", formats: ["ext4-efi" as const], imageCount: 25 },
    lookup,
    lookupAll,
    hashPassword: async (password: string) => `$6$salt$${password.length}`,
    now: new Date("2026-11-11T00:00:00Z"),
    ...overrides,
  };
}

describe("createBuildPlan", () => {
  it("resolves dependencies and never echoes the plaintext password", async () => {
    const plan = await createBuildPlan(form(), context());

    expect(plan.packages).toEqual(["luci-app-demo", "luci", "luci-base", "libc"]);
    expect(plan.resolved.find((item) => item.name === "libc")?.source).toBe("dependency");
    expect(plan.files[0].content).toContain("$6$salt$13");
    expect(plan.files[0].mode).toBe(0o755);
    expect(JSON.stringify(plan)).not.toContain("correct horse");
  });

  it("produces a plan for an empty package list", async () => {
    const plan = await createBuildPlan(form({ packages: [] }), context());
    expect(plan.packages).toEqual([]);
    expect(plan.resolved).toEqual([]);
  });

  it("names the artifact for each image type", async () => {
    const ext4 = await createBuildPlan(form({ imageType: "ext4-efi" }), context());
    const squashfs = await createBuildPlan(form({ imageType: "squashfs-efi" }), context());
    const tarball = await createBuildPlan(form({ imageType: "rootfs-tar" }), context());

    expect(ext4.artifactName).toBe("immortalwrt-25.12.2-x86-64-generic-ext4-combined-efi.img.gz");
    expect(squashfs.artifactName).toBe("immortalwrt-25.12.2-x86-64-generic-squashfs-combined-efi.img.gz");
    expect(tarball.artifactName).toBe("immortalwrt-25.12.2-x86-64-generic-targz-rootfs.tar.gz");
  });

  it("reports conflicts instead of silently proceeding", async () => {
    const plan = await createBuildPlan(form({ packages: ["dnsmasq", "dnsmasq-full"] }), context());
    expect(plan.conflicts).toEqual([
      { names: ["dnsmasq", "dnsmasq-full"], message: "dnsmasq 与 dnsmasq-full 不能同时安装" },
    ]);
  });

  it("records missing dependencies but keeps free-text packages", async () => {
    const plan = await createBuildPlan(form({ packages: ["ghost"] }), context());
    expect(plan.resolved).toEqual([
      {
        name: "ghost",
        version: null,
        source: "selected",
        packageSource: null,
        sourcePin: null,
        sha256: null,
        feed: null,
        license: null,
        proprietary: false,
      },
    ]);
    expect(plan.missingDependencies).toEqual([]);
  });

  it("records the actual source and download manifest for third-party packages", async () => {
    const plan = await createBuildPlan(form({ packages: ["lucky"] }), context());
    expect(plan.resolved[0]).toMatchObject({ name: "lucky", packageSource: "dllkids", sourcePin: "idx-sha" });
    expect(plan.topLevelPackages).toEqual(["lucky"]);
    expect(plan.compliance).toEqual({ publicEligible: true, issues: [] });
    expect(plan.downloads).toEqual([
      {
        name: "lucky",
        version: "3.5.0-r1",
        source: "dllkids",
        sourcePin: "idx-sha",
        url: "https://down.dllkids.xyz/openwrt-feed/25.12/x86_64/lucky-3.5.0-r1.apk",
        filename: "lucky-3.5.0-r1.apk",
        sha256: "b925d2f2e604f834f25f9170eba75700479fc4a48bd1f42efe4749bc5b2c7636",
      },
    ]);
    expect(plan.conflicts).toEqual([]);
  });

  it("rejects an explicit lower-priority source when official provides the package", async () => {
    const plan = await createBuildPlan(
      form({ packages: ["dllkids/luci"] }),
      context({
        lookupAll: (name) =>
          name === "luci" ? [official.luci, { ...official.luci, source: "dllkids", sourcePin: "idx-sha" }] : lookupAll(name),
      }),
    );
    expect(plan.conflicts.some((item) => item.message.includes("更高优先级来源 official"))).toBe(true);
  });

  it("rejects the same name requested from two sources", async () => {
    const plan = await createBuildPlan(
      form({ packages: ["lucky", "dllkids/lucky"] }),
      context({
        lookup: (name) =>
          name === "lucky" ? { ...dllkidsLucky, source: "official", sourcePin: "", feed: "packages" } : lookup(name),
        lookupAll: (name) =>
          name === "lucky" ? [{ ...dllkidsLucky, source: "official", sourcePin: "", feed: "packages" }, dllkidsLucky] : lookupAll(name),
      }),
    );
    expect(plan.conflicts.some((item) => item.message.includes("同时来自多个来源"))).toBe(true);
  });

  it("rejects non-official kmod packages", async () => {
    const plan = await createBuildPlan(
      form({ packages: ["dllkids/kmod-demo"] }),
      context({
        lookup: (name) => (name === "kmod-demo" ? lookupAll("kmod-demo")[0] : null),
        lookupAll: (name) => (name === "kmod-demo" ? lookupAll("kmod-demo") : []),
      }),
    );
    expect(plan.conflicts.some((item) => item.message.includes("kmod 只允许来自官方来源"))).toBe(true);
  });

  it("rejects version and sha pins that do not match the chosen package", async () => {
    const plan = await createBuildPlan(
      form({
        packages: ["lucky"],
        packagePins: [
          { name: "lucky", source: "dllkids", version: "9.9.9" },
          { name: "lucky", sha256: "0".repeat(64) },
        ],
      }),
      context(),
    );
    expect(plan.conflicts.some((item) => item.message.includes("固定版本 9.9.9"))).toBe(true);
    expect(plan.conflicts.some((item) => item.message.includes("sha256 与 pin 不一致"))).toBe(true);
  });

  it("rejects a package whose source pin does not match the snapshot", async () => {
    const plan = await createBuildPlan(
      form({ packages: ["lucky"] }),
      context({ sourcePins: { ...pins, dllkids: "different" } }),
    );
    expect(plan.conflicts.some((item) => item.message.includes("dllkids pin 与快照不一致"))).toBe(true);
  });

  it("accepts supplement packages pinned by the signed index checksum", async () => {
    const store = entry("luci-app-store", {
      version: "0.2.1-r1",
      source: "supplement",
      sourcePin: "supplement-index-sha",
      sha256: "c".repeat(64),
      filename: "luci-app-store-0.2.1-r1.apk",
      downloadUrl: "https://example.test/supplement/x86_64/luci-app-store-0.2.1-r1.apk",
      feed: "supplement",
    });
    const plan = await createBuildPlan(
      form({ packages: ["supplement/luci-app-store"] }),
      context({
        lookup: (name) => (name === "luci-app-store" ? store : null),
        lookupAll: (name) => (name === "luci-app-store" ? [store] : []),
        sourcePins: {
          ...pins,
          supplement: {
            commit: "a".repeat(40),
            fingerprint: "f".repeat(64),
            indexSha256: "supplement-index-sha",
          },
        },
      }),
    );

    expect(plan.conflicts).toEqual([]);
    expect(plan.resolved[0]).toMatchObject({ packageSource: "supplement", sourcePin: "supplement-index-sha" });
  });
});
