import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config";

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
