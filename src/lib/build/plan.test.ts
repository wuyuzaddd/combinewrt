import { describe, expect, it } from "vitest";
import { createBuildPlan } from "./plan";
import type { BuildFormInput, PackageLookup } from "./types";

const lookup: PackageLookup = (name) => {
  const packages: Record<string, { version: string; depends: string[] }> = {
    luci: { version: "1", depends: ["luci-base"] },
    "luci-base": { version: "1", depends: ["libc"] },
    libc: { version: "1", depends: [] },
    "luci-app-demo": { version: "2", depends: ["luci"] },
    "dnsmasq-full": { version: "1", depends: [] },
    "dnsmasq": { version: "1", depends: [] },
  };
  return packages[name] ?? null;
};

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

const context = {
  baseVersion: "25.12.2",
  feedCommit: "abc123",
  sourceNote: "fixture",
  profile: { id: "generic", title: "Generic x86/64", formats: ["ext4-efi" as const], imageCount: 25 },
  lookup,
  hashPassword: async (password: string) => `$6$salt$${password.length}`,
  now: new Date("2026-11-11T00:00:00Z"),
};

describe("createBuildPlan", () => {
  it("resolves dependencies and never echoes the plaintext password", async () => {
    const plan = await createBuildPlan(form(), context);

    expect(plan.packages).toEqual(["luci-app-demo", "luci", "luci-base", "libc"]);
    expect(plan.resolved.find((entry) => entry.name === "libc")?.source).toBe("dependency");
    expect(plan.files[0].content).toContain("$6$salt$13");
    expect(plan.files[0].mode).toBe(0o755);
    expect(JSON.stringify(plan)).not.toContain("correct horse");
  });

  it("produces a plan for an empty package list", async () => {
    const plan = await createBuildPlan(form({ packages: [] }), context);
    expect(plan.packages).toEqual([]);
    expect(plan.resolved).toEqual([]);
  });

  it("names the artifact for each image type", async () => {
    const ext4 = await createBuildPlan(form({ imageType: "ext4-efi" }), context);
    const squashfs = await createBuildPlan(form({ imageType: "squashfs-efi" }), context);
    const tarball = await createBuildPlan(form({ imageType: "rootfs-tar" }), context);

    expect(ext4.artifactName).toBe("immortalwrt-25.12.2-x86-64-generic-ext4-combined-efi.img.gz");
    expect(squashfs.artifactName).toBe("immortalwrt-25.12.2-x86-64-generic-squashfs-combined-efi.img.gz");
    expect(tarball.artifactName).toBe("immortalwrt-25.12.2-x86-64-generic-targz-rootfs.tar.gz");
  });

  it("reports conflicts instead of silently proceeding", async () => {
    const plan = await createBuildPlan(form({ packages: ["dnsmasq", "dnsmasq-full"] }), context);
    expect(plan.conflicts).toEqual([
      { names: ["dnsmasq", "dnsmasq-full"], message: "dnsmasq 与 dnsmasq-full 不能同时安装" },
    ]);
  });

  it("records missing dependencies but keeps free-text packages", async () => {
    const plan = await createBuildPlan(form({ packages: ["ghost"] }), context);
    expect(plan.resolved).toEqual([{ name: "ghost", version: null, source: "selected" }]);
    expect(plan.missingDependencies).toEqual([]);
  });
});
