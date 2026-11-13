import { describe, expect, it } from "vitest";
import { createSourceOffer, sourceOfferJson } from "./manifest";
import type { BuildRecord } from "../builds/types";
import type { BuildPlan } from "../build/types";
import { EMPTY_SOURCE_PINS } from "../catalog/types";

const plan: BuildPlan = {
  baseVersion: "25.12.2",
  feedCommit: "abc123",
  sourceNote: "fixture",
  profileId: "generic",
  profileTitle: "Generic x86/64",
  imageType: "ext4-efi",
  packages: ["lucky", "luci-app-lucky", "mosdns"],
  resolved: [
    {
      name: "lucky",
      version: "3.5.0-r1",
      source: "selected",
      packageSource: "dllkids",
      sourcePin: "dllkids-pin",
      sha256: "a".repeat(64),
      feed: "dllkids",
      license: "GPL-3.0-only",
      proprietary: false,
    },
    {
      name: "mosdns",
      version: "5.3.3-r1",
      source: "selected",
      packageSource: "official",
      sourcePin: "packages-pin",
      sha256: "b".repeat(64),
      feed: "packages",
      license: "GPL-3.0-only",
      proprietary: false,
    },
  ],
  missingDependencies: [],
  conflicts: [],
  files: [
    { path: "files/etc/uci-defaults/99-combinewrt", content: "root:$1$secretcrypt", mode: 0o755 },
  ],
  artifactName: "immortalwrt-25.12.2-x86-64-generic-ext4-combined-efi.img.gz",
  imageBuilderCommand: "make image",
  createdAt: "2026-11-13T00:00:00.000Z",
  sourcePins: {
    ...EMPTY_SOURCE_PINS,
    official: { packages: "packages-pin" },
    dllkids: "dllkids-index-sha",
    supplement: { commit: null, fingerprint: "supplement-key-sha", indexSha256: "supplement-index-sha" },
    kernel: { version: "6.12.103", release: "1", vermagic: "vera" },
  },
  topLevelPackages: ["lucky", "luci-app-lucky", "mosdns"],
  downloads: [],
  patches: [],
  compliance: { publicEligible: true, issues: [] },
};

const build: BuildRecord = {
  id: "build-1",
  plan,
  config: {
    profile: "generic",
    imageType: "ext4-efi",
    hostname: "combinewrt",
    timezone: "UTC",
    lanIp: "192.168.1.1",
    netmask: "255.255.255.0",
    packages: plan.packages,
  },
  status: "succeeded",
  runId: "42",
  adapter: "github",
  logTail: "",
  error: null,
  artifactName: plan.artifactName,
  createdAt: "2026-11-13T00:00:00.000Z",
  updatedAt: "2026-11-13T00:00:00.000Z",
};

describe("createSourceOffer", () => {
  it("records the baseline, all pins, packages, config and patch list", () => {
    const offer = createSourceOffer(build, {
      imageBuilder: {
        version: "25.12.2",
        releaseDate: "2026-09-08",
        imageBuilderUrl: "https://example.test/ib.tar.zst",
        imageBuilderSha256: "c".repeat(64),
        createdAt: "2026-09-08T00:00:00.000Z",
      },
    });

    expect(offer.openwrtTag).toBe("v25.12.2");
    expect(offer.imageBuilder).toEqual({
      url: "https://example.test/ib.tar.zst",
      sha256: "c".repeat(64),
    });
    expect(offer.sourcePins.official).toEqual({ packages: "packages-pin" });
    expect(offer.sourcePins.dllkids).toBe("dllkids-index-sha");
    expect(offer.sourcePins.supplement).toEqual({
      commit: null,
      fingerprint: "supplement-key-sha",
      indexSha256: "supplement-index-sha",
    });
    expect(offer.packages.map((pkg) => [pkg.name, pkg.source, pkg.sourcePin])).toEqual([
      ["lucky", "dllkids", "dllkids-pin"],
      ["mosdns", "official", "packages-pin"],
    ]);
    expect(offer.config?.hostname).toBe("combinewrt");
    expect(offer.generatedFiles).toEqual(["files/etc/uci-defaults/99-combinewrt"]);
    expect(offer.patches).toEqual([]);
  });

  it("does not publish root password hashes or generated file contents", () => {
    const json = sourceOfferJson(createSourceOffer(build));
    expect(json).not.toContain("secretcrypt");
    expect(json).not.toContain("root:$1$");
    expect(json).toContain("Root password hashes and generated file contents are deliberately omitted.");
  });

  it("falls back to an empty pin set for legacy plans", () => {
    const legacy = { ...build, plan: { ...plan, sourcePins: undefined } } as unknown as BuildRecord;
    const offer = createSourceOffer(legacy);
    expect(offer.sourcePins).toEqual(EMPTY_SOURCE_PINS);
  });
});
