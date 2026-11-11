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

  it("rejects a short session secret", () => {
    expect(() => loadConfig({ SESSION_SECRET: "short", ADMIN_PASSWORD_HASH: HASH })).toThrow(/32/);
  });

  it("rejects a malformed password hash", () => {
    expect(() => loadConfig({ SESSION_SECRET: SECRET, ADMIN_PASSWORD_HASH: "plain" })).toThrow(/ADMIN_PASSWORD_HASH/);
  });
});
