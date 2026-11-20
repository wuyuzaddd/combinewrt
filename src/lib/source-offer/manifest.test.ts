import { describe, expect, it } from "vitest";
import { createSourceOffer, distributionLabel, sourceOfferJson } from "./manifest";
import type { BuildRecord } from "../builds/types";
import type { BuildPlan } from "../build/types";
import type { ModeState } from "../build/types";
import { EMPTY_SOURCE_PINS } from "../catalog/types";

const PIN = "e".repeat(64);

const plan: BuildPlan = {
  baseVersion: "25.12.2",
  feedCommit: "abc123",
  sourceNote: "fixture",
  profileId: "generic",
  profileTitle: "Generic x86/64",
  imageType: "ext4-efi",
  visibility: "public",
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
        channel: "release",
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
    expect(offer.visibility).toBe("public");
    expect(offer.publicDistribution).toBe(true);
    expect(offer.feedSet).toBeNull();
    expect(offer.notes.join("\n")).toContain("Distribution conclusion: this image is marked public");
  });

  it("does not publish root password hashes or generated file contents", () => {
    const json = sourceOfferJson(createSourceOffer(build));
    expect(json).not.toContain("secretcrypt");
    expect(json).not.toContain("root:$1$");
    expect(json).toContain("Root password hashes and generated file contents are deliberately omitted.");
  });

  it("keeps a plan without schemaVersion readable as a V1 source offer", () => {
    const offer = createSourceOffer(build);
    expect(offer.schemaVersion).toBe(1);
    expect(offer.openwrtTag).toBe("v25.12.2");
  });

  it("falls back to an empty pin set for legacy plans", () => {
    const legacy = { ...build, plan: { ...plan, sourcePins: undefined } } as unknown as BuildRecord;
    const offer = createSourceOffer(legacy);
    expect(offer.sourcePins).toEqual(EMPTY_SOURCE_PINS);
  });

  it("summarizes the selected modes without network settings or secrets", () => {
    const modes = {
      basePreset: { id: "router-default", layer: "file/board", title: "Router default", experimental: false },
      overlays: [{ id: "pppoe", layer: "file/board", title: "PPPoE", experimental: false }],
      experimental: [],
      secrets: [
        { kind: "https-selfsigned", commonName: "router", certPath: "/etc/uhttpd.crt", keyPath: "/etc/uhttpd.key" },
      ],
      generatedFiles: ["/etc/uci-defaults/90-combinewrt-modes"],
      network: { wan: { protocol: "pppoe", username: "user", password: "supersecret" } },
    } as unknown as ModeState;
    const { imageType: v1OnlyImageType, ...basePlan } = plan;
    void v1OnlyImageType;
    const v2plan = {
      ...basePlan,
      schemaVersion: 2 as const,
      imageVariant: { boot: "efi" as const, filesystem: "ext4" as const, artifact: "combined" as const },
      channel: "release" as const,
      target: { id: "x86/64", architecture: "x86_64", subtarget: "generic", title: "x86/64" },
      deviceProfile: { targetId: "x86/64", id: "generic", title: "Generic x86/64", capabilities: [] },
      kernelLine: { id: "6.12", version: "6.12", engine: "imagebuilder" as const },
      basePreset: { id: "minimal", layer: "file/board" as const },
      overlays: [],
      engine: "imagebuilder" as const,
      modes,
    } as BuildPlan;

    const offer = createSourceOffer({ ...build, plan: v2plan });
    expect(offer.schemaVersion).toBe(1);
    expect(offer.modes).toEqual({
      basePreset: { id: "router-default", layer: "file/board", title: "Router default", experimental: false },
      overlays: [{ id: "pppoe", layer: "file/board", title: "PPPoE", experimental: false }],
      experimental: [],
      generatedFiles: ["/etc/uci-defaults/90-combinewrt-modes"],
    });
    const json = sourceOfferJson(offer);
    expect(json).not.toContain("supersecret");
    expect(json).not.toContain("PRIVATE KEY");
    expect(json).toContain("PPPoE credentials and the HTTPS private key are deliberately omitted");
  });

  it("carries the adopted dllkids pin from a V2 build plan", () => {
    const adopted = {
      ...plan,
      schemaVersion: 2,
      imageVariant: { boot: "efi", filesystem: "ext4", artifact: "combined" },
      sourcePins: { ...plan.sourcePins, dllkids: PIN },
    };
    const offer = createSourceOffer({ ...build, plan: adopted } as BuildRecord);
    // The source-offer schema stays 1 so V1 consumers keep working; only the
    // pin value changes, and it names the pin the build actually used.
    expect(offer.schemaVersion).toBe(1);
    expect(offer.sourcePins.dllkids).toBe(PIN);
    expect(JSON.parse(sourceOfferJson(offer)).sourcePins.dllkids).toBe(PIN);
    expect(offer.notes.join("\n")).not.toContain("source pins were not captured");
  });

  it("records the feed set with pins and no private key material", () => {
    const feedSet = {
      visibility: "private" as const,
      baseVersion: "25.12.2",
      targetId: "x86/64",
      feedTarget: "x86_64",
      officialBaseUrl: "https://downloads.immortalwrt.org",
      officialMirror: null,
      officialRepositories: [
        "https://downloads.immortalwrt.org/releases/25.12.2/targets/x86/64/packages/packages.adb",
      ],
      key: {
        path: "/etc/apk/keys/combinewrt-feed.pub.pem",
        url: "https://wuyuzaddd.github.io/combinewrt-packages/keys/combinewrt-feed.pub.pem",
        fingerprint: PIN,
      },
      repositories: [
        {
          id: "supplement" as const,
          url: "https://wuyuzaddd.github.io/combinewrt-packages/supplement/25.12.2/x86_64/packages.adb",
          signed: true,
          inDefaultRepositoryList: true,
          condition: "signed supplement feed (always enabled)",
          indexSha256: "supplement-index-sha",
          keyFingerprint: PIN,
        },
        {
          id: "dllkids" as const,
          url: "https://down.dllkids.xyz/openwrt-feed/25.12/x86_64/packages.adb",
          signed: false,
          inDefaultRepositoryList: false,
          condition: "private image only",
          indexSha256: "stale-config-seed",
          keyFingerprint: null,
        },
      ],
      files: [{ path: "/etc/apk/repositories.d/90-combinewrt.list", content: "-----BEGIN PRIVATE KEY-----", mode: 0o600 }],
    };
    const v2plan = {
      ...plan,
      schemaVersion: 2 as const,
      imageVariant: { boot: "efi" as const, filesystem: "ext4" as const, artifact: "combined" as const },
      sourcePins: { ...plan.sourcePins, dllkids: PIN },
      feedSet,
    } as unknown as BuildPlan;

    const offer = createSourceOffer({ ...build, plan: v2plan });
    expect(offer.feedSet?.visibility).toBe("private");
    expect(offer.feedSet?.repositories.map((repository) => repository.id)).toEqual([
      "supplement",
      "dllkids",
    ]);
    expect(offer.feedSet?.repositories[0]?.indexSha256).toBe("supplement-index-sha");
    expect(offer.feedSet?.repositories[0]?.keyFingerprint).toBe(PIN);
    expect(offer.feedSet?.repositories[1]?.keyFingerprint).toBeNull();
    // ADR 0009 ruling 1: the offer's dllkids sha comes from `plan.sourcePins`,
    // so a plan that still carried the stale seed cannot publish that seed.
    expect(offer.feedSet?.repositories[1]?.indexSha256).toBe(PIN);
    expect(offer.feedSet?.key.fingerprint).toBe(PIN);
    expect(offer.feedSet).not.toHaveProperty("files");

    const json = sourceOfferJson(offer);
    expect(json).not.toContain("PRIVATE KEY");
    expect(json).not.toContain("BEGIN");
    expect(json).toContain("Image feed set");
  });

  it("marks a config-seed dllkids pin in the source offer", () => {
    const seed = "f".repeat(64);
    const feedSet = {
      visibility: "private" as const,
      baseVersion: "25.12.2",
      targetId: "x86/64",
      feedTarget: "x86_64",
      officialBaseUrl: "https://downloads.immortalwrt.org",
      officialMirror: null,
      officialRepositories: [],
      key: {
        path: "/etc/apk/keys/combinewrt-feed.pub.pem",
        url: "https://wuyuzaddd.github.io/combinewrt-packages/keys/combinewrt-feed.pub.pem",
        fingerprint: PIN,
      },
      repositories: [
        {
          id: "dllkids" as const,
          url: "https://down.dllkids.xyz/openwrt-feed/25.12/x86_64/packages.adb",
          signed: false,
          inDefaultRepositoryList: false,
          condition: "private image only",
          indexSha256: seed,
          indexSha256Source: "config-seed" as const,
          keyFingerprint: null,
        },
      ],
      files: [],
    };
    const v2plan = {
      ...plan,
      schemaVersion: 2 as const,
      imageVariant: { boot: "efi" as const, filesystem: "ext4" as const, artifact: "combined" as const },
      sourcePins: { ...plan.sourcePins, dllkids: seed },
      feedSet,
    } as unknown as BuildPlan;

    const offer = createSourceOffer({ ...build, plan: v2plan });
    expect(offer.feedSet?.repositories[0]?.indexSha256Source).toBe("config-seed");
    expect(offer.notes.join("\n")).toContain("no adopted database pin exists yet");
    expect(offer.notes.join("\n")).toContain("the configured first-install seed");
  });

  it("renders the V2 composition and acquisition strategies without network secrets", () => {
    const v2plan = {
      ...plan,
      schemaVersion: 2 as const,
      channel: "release" as const,
      target: { id: "x86/64", architecture: "x86_64", subtarget: "generic", title: "x86/64 (generic)" },
      deviceProfile: { targetId: "x86/64", id: "generic", title: "Generic x86/64", capabilities: ["efi"] },
      kernelLine: { id: "6.12", version: "6.12", engine: "imagebuilder" as const },
      imageVariant: { boot: "efi" as const, filesystem: "ext4" as const, artifact: "combined" as const, overlaySizeMb: 1024 },
      basePreset: { id: "minimal", layer: "file/board" as const },
      overlays: [],
      engine: "imagebuilder" as const,
      modes: {
        basePreset: { id: "minimal", layer: "file/board" as const, title: "Minimal", experimental: false },
        overlays: [],
        experimental: [],
        secrets: [],
        generatedFiles: [],
        network: { wan: { protocol: "pppoe", username: "user", password: "supersecret" } },
      },
      resolved: [
        {
          name: "lucky",
          version: "3.5.0-r1",
          source: "selected" as const,
          packageSource: "dllkids" as const,
          sourcePin: "dllkids-pin",
          sha256: null,
          feed: "dllkids",
          requestedStrategy: "prebuilt" as const,
          effectiveStrategy: "rebuild" as const,
          fallbackReason: "prebuilt unavailable; rebuilding",
        },
      ],
    } as unknown as BuildPlan;

    const offer = createSourceOffer({ ...build, plan: v2plan } as BuildRecord);
    expect(offer.v2?.engine).toBe("imagebuilder");
    expect(offer.v2?.target.id).toBe("x86/64");
    expect(offer.v2?.kernelLine.id).toBe("6.12");
    expect(offer.v2?.imageVariant.artifact).toBe("combined");
    expect(offer.v2?.strategies).toEqual([
      {
        name: "lucky",
        source: "dllkids",
        requested: "prebuilt",
        effective: "rebuild",
        fallbackReason: "prebuilt unavailable; rebuilding",
      },
    ]);
    expect(offer.packages[0].strategy).toEqual({
      requested: "prebuilt",
      effective: "rebuild",
      fallbackReason: "prebuilt unavailable; rebuilding",
    });
    const json = sourceOfferJson(offer);
    expect(json).not.toContain("supersecret");
    expect(json).not.toContain("pppoe");
    expect(json).toContain("V2 composition");
  });

  it("leaves a V1 offer without a V2 section", () => {
    const offer = createSourceOffer(build);
    expect(offer.v2).toBeUndefined();
    expect(offer.packages[0].strategy).toBeUndefined();
  });
});


describe("distributionLabel", () => {
  it("keeps private intent separate from license eligibility", () => {
    expect(distributionLabel("private", true)).toBe("自用（未公开分发）");
    expect(distributionLabel("private", false)).toBe("自用（未公开分发）");
    expect(distributionLabel("public", true)).toBe("允许公开分发");
    expect(distributionLabel("public", false)).toBe("不得作为公开镜像发布");
  });
});

describe("source offer channel (ticket 11)", () => {
  it("carries the snapshot channel and the plan's forced private visibility", () => {
    const v2plan = {
      ...plan,
      schemaVersion: 2 as const,
      channel: "snapshot" as const,
      visibility: "private" as const,
      target: { id: "x86/64", architecture: "x86_64", subtarget: "generic", title: "x86/64 (generic)" },
      deviceProfile: { targetId: "x86/64", id: "generic", title: "Generic x86/64", capabilities: ["efi"] },
      kernelLine: { id: "6.12", version: "6.12", engine: "imagebuilder" as const },
      imageVariant: { boot: "efi" as const, filesystem: "ext4" as const, artifact: "combined" as const },
      engine: "imagebuilder" as const,
    } as unknown as BuildPlan;

    const offer = createSourceOffer({ ...build, plan: v2plan } as BuildRecord);
    expect(offer.v2?.channel).toBe("snapshot");
    expect(offer.visibility).toBe("private");
    const json = sourceOfferJson(offer);
    expect(json).toContain('"channel": "snapshot"');
  });
});
