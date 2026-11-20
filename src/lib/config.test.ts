import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig, loadImageFeedConfig } from "./config";

const SECRET = "0123456789abcdef0123456789abcdef";
const HASH = `scrypt$${"ab".repeat(16)}$${"cd".repeat(64)}`;

describe("loadConfig", () => {
  it("returns a typed config when the environment is complete", () => {
    const config = loadConfig({ SESSION_SECRET: SECRET, ADMIN_PASSWORD_HASH: HASH });
    expect(config.sessionSecret).toBe(SECRET);
    expect(config.adminPasswordHash).toBe(HASH);
    expect(config.databasePath).toBe("./data/combinewrt.db");
    expect(config.appOrigin).toBe("http://localhost:3000");
    expect(config.secureCookies).toBe(false);
    expect(config.artifactRetentionDays).toBe(7);
    expect(config.artifactCacheMaxBytes).toBe(20 * 1024 ** 3);
    expect(config.artifactCacheDir).toContain("artifacts");
    expect(config.supplementFeedUrl).toContain("combinewrt-packages");
    expect(config.supplementKeyFingerprint).toHaveLength(64);
    expect(config.supplementWorkflow).toBe("packages.yml");
  });

  it("rejects an invalid artifact cache ceiling", () => {
    expect(() =>
      loadConfig({
        SESSION_SECRET: SECRET,
        ADMIN_PASSWORD_HASH: HASH,
        ARTIFACT_CACHE_MAX_BYTES: "-1",
      }),
    ).toThrow(/ARTIFACT_CACHE_MAX_BYTES/);
  });

  it("rejects a malformed supplement workflow name", () => {    expect(() =>
      loadConfig({
        SESSION_SECRET: SECRET,
        ADMIN_PASSWORD_HASH: HASH,
        SUPPLEMENT_WORKFLOW: "../packages.yml",
      }),
    ).toThrow(/SUPPLEMENT_WORKFLOW/);
  });

  it("rejects a malformed supplement feed URL", () => {
    expect(() =>
      loadConfig({
        SESSION_SECRET: SECRET,
        ADMIN_PASSWORD_HASH: HASH,
        SUPPLEMENT_FEED_URL: "ftp://example.com/feed",
      }),
    ).toThrow(/SUPPLEMENT_FEED_URL/);
  });

  it("rejects an out-of-range artifact retention", () => {
    expect(() =>
      loadConfig({
        SESSION_SECRET: SECRET,
        ADMIN_PASSWORD_HASH: HASH,
        ARTIFACT_RETENTION_DAYS: "999",
      }),
    ).toThrow(/ARTIFACT_RETENTION_DAYS/);
  });

  it("reports every missing variable at once", () => {
    try {
      loadConfig({});
      throw new Error("expected loadConfig to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const { issues } = error as ConfigError;
      expect(issues.join("\n")).toContain("SESSION_SECRET");
      expect(issues.join("\n")).toContain("ADMIN_PASSWORD_HASH");
      expect(issues.join("\n")).toContain("npm run hash-password");
    }
  });

  it("marks cookies secure for https origins", () => {
    const config = loadConfig({
      SESSION_SECRET: SECRET,
      ADMIN_PASSWORD_HASH: HASH,
      APP_ORIGIN: "https://build.example.com",
    });
    expect(config.secureCookies).toBe(true);
  });

  it("rejects a malformed app origin", () => {
    expect(() =>
      loadConfig({ SESSION_SECRET: SECRET, ADMIN_PASSWORD_HASH: HASH, APP_ORIGIN: "ftp://example.com" }),
    ).toThrow(/APP_ORIGIN/);
  });

  it("rejects a short session secret", () => {
    expect(() => loadConfig({ SESSION_SECRET: "short", ADMIN_PASSWORD_HASH: HASH })).toThrow(/32/);
  });

  it("requires repo and token for the github adapter", () => {
    expect(() =>
      loadConfig({ SESSION_SECRET: SECRET, ADMIN_PASSWORD_HASH: HASH, BUILD_ADAPTER: "github" }),
    ).toThrow(/BUILD_REPO/);
    expect(() =>
      loadConfig({
        SESSION_SECRET: SECRET,
        ADMIN_PASSWORD_HASH: HASH,
        BUILD_ADAPTER: "github",
        BUILD_REPO: "me/build",
      }),
    ).toThrow(/BUILD_REPO_TOKEN/);
  });

  it("accepts a configured github adapter", () => {
    const config = loadConfig({
      SESSION_SECRET: SECRET,
      ADMIN_PASSWORD_HASH: HASH,
      BUILD_ADAPTER: "github",
      BUILD_REPO: "me/build",
      BUILD_REPO_TOKEN: "token",
    });
    expect(config.buildAdapter).toBe("github");
    expect(config.buildRepo).toBe("me/build");
  });

  it("rejects an unknown adapter", () => {
    expect(() =>
      loadConfig({ SESSION_SECRET: SECRET, ADMIN_PASSWORD_HASH: HASH, BUILD_ADAPTER: "jenkins" }),
    ).toThrow(/BUILD_ADAPTER/);
  });

  it("rejects a malformed password hash", () => {
    expect(() => loadConfig({ SESSION_SECRET: SECRET, ADMIN_PASSWORD_HASH: "plain" })).toThrow(/ADMIN_PASSWORD_HASH/);
  });
});

describe("loadImageFeedConfig", () => {
  it("defaults to the canonical official base and the project feed site", () => {
    const config = loadImageFeedConfig({});
    expect(config.officialBaseUrl).toBe("https://downloads.immortalwrt.org");
    expect(config.officialMirror).toBeNull();
    expect(config.feedBaseUrl).toBe("https://wuyuzaddd.github.io/combinewrt-packages");
    expect(config.keyFingerprint).toHaveLength(64);
    expect(config.dllkidsIndexSha256).toHaveLength(64);
    expect(config.supplementIndexSha256).toBeNull();
    expect(config.extensionIndexSha256).toBeNull();
  });

  it("reads the explicit dllkids seed alias", () => {
    const config = loadImageFeedConfig({ DLLKIDS_INDEX_SHA256_SEED: "c".repeat(64) });
    expect(config.dllkidsIndexSha256).toBe("c".repeat(64));
  });

  it("still accepts the legacy DLLKIDS_INDEX_SHA256 name", () => {
    const config = loadImageFeedConfig({ DLLKIDS_INDEX_SHA256: "d".repeat(64) });
    expect(config.dllkidsIndexSha256).toBe("d".repeat(64));
  });

  it("lets the explicit seed name win over the legacy alias", () => {
    const config = loadImageFeedConfig({
      DLLKIDS_INDEX_SHA256_SEED: "e".repeat(64),
      DLLKIDS_INDEX_SHA256: "f".repeat(64),
    });
    expect(config.dllkidsIndexSha256).toBe("e".repeat(64));
  });

  it("rejects a malformed dllkids seed from either name", () => {
    expect(() => loadImageFeedConfig({ DLLKIDS_INDEX_SHA256_SEED: "not-a-sha" })).toThrow(
      /DLLKIDS_INDEX_SHA256_SEED/,
    );
    expect(() => loadImageFeedConfig({ DLLKIDS_INDEX_SHA256: "not-a-sha" })).toThrow(
      /DLLKIDS_INDEX_SHA256_SEED/,
    );
  });

  it("honours IMMORTALWRT_MIRROR and records the trimmed value", () => {
    const config = loadImageFeedConfig({
      IMMORTALWRT_MIRROR: "https://mirror.example.test/immortalwrt/",
    });
    expect(config.officialMirror).toBe("https://mirror.example.test/immortalwrt");
    expect(config.officialBaseUrl).toBe("https://mirror.example.test/immortalwrt");
  });

  it("honours the project feed base and optional index pins", () => {
    const config = loadImageFeedConfig({
      COMBINEWRT_FEED_BASE_URL: "https://packages.example.test/",
      SUPPLEMENT_INDEX_SHA256: "a".repeat(64),
      EXTENSION_INDEX_SHA256: "b".repeat(64),
    });
    expect(config.feedBaseUrl).toBe("https://packages.example.test");
    expect(config.supplementIndexSha256).toBe("a".repeat(64));
    expect(config.extensionIndexSha256).toBe("b".repeat(64));
  });

  it("rejects an invalid mirror without needing SESSION_SECRET", () => {
    expect(() => loadImageFeedConfig({ IMMORTALWRT_MIRROR: "ftp://mirror.test" })).toThrow(
      /IMMORTALWRT_MIRROR/,
    );
  });

  it("is exposed on the full config", () => {
    const config = loadConfig({ SESSION_SECRET: SECRET, ADMIN_PASSWORD_HASH: HASH });
    expect(config.imageFeed.officialBaseUrl).toBe("https://downloads.immortalwrt.org");
  });
});
