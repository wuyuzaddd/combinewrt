import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { SourcePins } from "../catalog/types";
import type { ExtensionBundle } from "../extension/types";
import { createSourceRegistry } from "../sources/registry";
import type { SourceRegistryEntry } from "../sources/types";
import { createBuildPlanV2, type PlanV2Context } from "./plan-v2";
import type { BuildFormInputV2, PackageLookup, PackageLookupEntry } from "./types";

const ref = "a".repeat(40);
const otherRef = "f".repeat(40);
const openclashRepo = "vernesong/OpenClash";
const openclashRecipe = `github:${openclashRepo}@${ref}/luci-app-openclash`;

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

const lucky = entry("lucky", {
  version: "3.5.0-r1",
  source: "dllkids",
  sourcePin: "idx-sha",
  sha256: "b925d2f2e604f834f25f9170eba75700479fc4a48bd1f42efe4749bc5b2c7636",
  filename: "lucky-3.5.0-r1.apk",
  downloadUrl: "https://down.dllkids.xyz/openwrt-feed/25.12/x86_64/lucky-3.5.0-r1.apk",
  feed: "dllkids",
});

const openclashExtension: SourceRegistryEntry = {
  name: "luci-app-openclash",
  source: "extension",
  pin: ref,
  ref,
  repo: openclashRepo,
  subdir: "luci-app-openclash",
  license: "MIT",
  publicAllowed: true,
  targets: ["x86/64"],
  strategy: "rebuild",
  recipe: openclashRecipe,
  recipeHash: createHash("sha256").update(openclashRecipe).digest("hex"),
};

const openclash = entry("luci-app-openclash", {
  source: "extension",
  sourcePin: ref,
  filename: null,
  downloadUrl: null,
  feed: "extension",
  version: ref.slice(0, 12),
});

const baseEntries: SourceRegistryEntry[] = [
  { name: "luci-app-demo", source: "official", pin: "releases/25.12.2", license: "MIT", publicAllowed: true, strategy: "prebuilt" },
  { name: "lucky", source: "dllkids", pin: "idx-sha", license: "GPL-2.0-only", publicAllowed: false, strategy: "prebuilt" },
  openclashExtension,
];

function registryWith(entries: SourceRegistryEntry[] = []) {
  return createSourceRegistry([...baseEntries, ...entries]);
}

const lookup: PackageLookup = (name) => {
  if (name === "luci-app-demo") return entry("luci-app-demo");
  if (name === "lucky") return lucky;
  if (name === "luci-app-openclash") return openclash;
  return entry(name);
};

function lookupAll(name: string): PackageLookupEntry[] {
  const found = lookup(name);
  return found ? [found] : [];
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
    sources: registryWith(),
    bundles: [],
    hashPassword: async () => "$6$hash",
    now: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function conflictsOf(outcome: Awaited<ReturnType<typeof createBuildPlanV2>>): string {
  expect(outcome.ok).toBe(true);
  if (!outcome.ok) throw new Error(outcome.issues.join("; "));
  return outcome.conflicts.map((conflict) => conflict.message).join("\n");
}

function planOf(outcome: Awaited<ReturnType<typeof createBuildPlanV2>>) {
  expect(outcome.ok).toBe(true);
  if (!outcome.ok) throw new Error(outcome.issues.join("; "));
  return outcome.plan;
}

const proxyBundle: ExtensionBundle = {
  id: "proxy-openclash",
  title: "OpenClash 代理",
  description: "开箱可用的代理面板。",
  category: "proxy",
  packages: ["luci-app-openclash"],
  targets: ["x86/64"],
  license: "MIT",
  publicAllowed: true,
  tests: ["dependency"],
};

describe("createBuildPlanV2 extension integration", () => {
  it("turns a snapshot-decidable dependency gap into a conflict naming package, dependency and source", async () => {
    const closureSources = createSourceRegistry([
      {
        name: "ghost",
        source: "official",
        pin: "releases/25.12.2",
        license: "MIT",
        publicAllowed: true,
        strategy: "prebuilt",
      },
    ]);
    const closureLookup: PackageLookup = (name) =>
      name === "app" ? entry("app", { depends: ["ghost"] }) : null;

    const plan = planOf(
      await createBuildPlanV2(
        formV2({ packages: ["app"] }),
        contextV2({
          lookup: closureLookup,
          lookupAll: (name) => (name === "app" ? [closureLookup(name)!] : []),
          sources: closureSources,
        }),
      ),
    );

    const message = plan.conflicts.map((conflict) => conflict.message).join("\n");
    expect(message).toContain('Package "app" (official)');
    expect(message).toContain('"ghost" (official)');
    expect(message).toContain("workflow preflight remains authoritative");
    expect(plan.warnings?.join("\n") ?? "").not.toContain("workflow preflight remains authoritative");
  });

  it("keeps an unknown dependency as a warning when the snapshot cannot decide", async () => {
    const closureLookup: PackageLookup = (name) =>
      name === "app" ? entry("app", { depends: ["mystery"] }) : null;

    const plan = planOf(
      await createBuildPlanV2(
        formV2({ packages: ["app"] }),
        contextV2({ lookup: closureLookup, lookupAll: (name) => (name === "app" ? [closureLookup(name)!] : []) }),
      ),
    );

    expect(plan.conflicts.map((conflict) => conflict.message).join("\n")).not.toContain('"mystery"');
    expect(plan.warnings?.join("\n")).toContain('"mystery"');
  });

  it("names the source in a strategy 409 even when the package has no registered source", async () => {
    const unknownLookup: PackageLookup = () => null;

    const plan = planOf(
      await createBuildPlanV2(
        formV2({ packages: ["unlisted"] }),
        contextV2({ lookup: unknownLookup, lookupAll: () => [] }),
      ),
    );

    const message = plan.conflicts.map((conflict) => conflict.message).join("\n");
    expect(message).toContain('Package "unlisted" (source: unknown)');
  });

  it("rejects a non-publicAllowed package in a public plan with a 409-grade conflict naming package and source", async () => {
    const message = conflictsOf(
      await createBuildPlanV2(formV2({ visibility: "public", packages: ["lucky"] }), contextV2()),
    );
    expect(message).toMatch(/not publicAllowed/);
    expect(message).toContain("lucky");
    expect(message).toContain("dllkids");
  });

  it("allows the same package in a private plan", async () => {
    const message = conflictsOf(
      await createBuildPlanV2(formV2({ visibility: "private", packages: ["lucky"] }), contextV2()),
    );
    expect(message).not.toMatch(/not publicAllowed/);
  });

  it("rejects a non-official package that has no registry record in a public plan", async () => {
    const unregistered = entry("unknown-addon", {
      source: "dllkids",
      sourcePin: "idx-sha",
      sha256: "b".repeat(64),
      filename: "unknown-addon-1.apk",
      downloadUrl: "https://down.dllkids.xyz/openwrt-feed/25.12/x86_64/unknown-addon-1.apk",
      feed: "dllkids",
    });
    const message = conflictsOf(
      await createBuildPlanV2(
        formV2({ visibility: "public", packages: ["unknown-addon"] }),
        contextV2({
          lookup: (name) => (name === "unknown-addon" ? unregistered : lookup(name)),
          lookupAll: (name) => (name === "unknown-addon" ? [unregistered] : lookupAll(name)),
        }),
      ),
    );
    expect(message).toMatch(/is not in the source registry/);
    expect(message).toContain("dllkids");
  });

  it("rejects an extension package whose resolved pin differs from the registry ref", async () => {
    const drifted = { ...openclash, sourcePin: otherRef };
    const message = conflictsOf(
      await createBuildPlanV2(
        formV2({ visibility: "public", packages: ["luci-app-openclash"] }),
        contextV2({
          lookup: (name) => (name === "luci-app-openclash" ? drifted : lookup(name)),
          lookupAll: (name) => (name === "luci-app-openclash" ? [drifted] : lookupAll(name)),
        }),
      ),
    );
    expect(message).toMatch(/pinned to/);
    expect(message).toContain(ref);
    expect(message).toContain(otherRef);
  });

  it("expands bundle:<id> into plain package requests and adds the signed extension feed", async () => {
    const plan = planOf(
      await createBuildPlanV2(
        formV2({ visibility: "public", packages: ["bundle:proxy-openclash"] }),
        contextV2({ bundles: [proxyBundle] }),
      ),
    );

    expect(plan.packages).toContain("luci-app-openclash");
    expect(plan.resolved.map((item) => item.name)).toContain("luci-app-openclash");
    const extensionRepo = plan.feedSet?.repositories.find((repository) => repository.id === "extension");
    expect(extensionRepo?.url).toBe(
      "https://wuyuzaddd.github.io/combinewrt-packages/extension/25.12.2/x86_64/packages.adb",
    );
    expect(extensionRepo?.signed).toBe(true);
    expect(plan.preflight?.repositories.join("\n")).toContain("/extension/25.12.2/x86_64/packages.adb");
  });

  it("reports an unknown bundle id as a conflict", async () => {
    const message = conflictsOf(
      await createBuildPlanV2(
        formV2({ packages: ["bundle:does-not-exist"] }),
        contextV2({ bundles: [proxyBundle] }),
      ),
    );
    expect(message).toMatch(/未知套餐/);
  });

  it("skips a bundle that does not support the plan target", async () => {
    const message = conflictsOf(
      await createBuildPlanV2(
        formV2({ packages: ["bundle:proxy-openclash"] }),
        contextV2({ bundles: [{ ...proxyBundle, targets: ["aarch64/generic"] }] }),
      ),
    );
    expect(message).toMatch(/不支持目标/);
  });
});
