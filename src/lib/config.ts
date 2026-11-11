import { PASSWORD_HASH_PATTERN } from "./auth/password-format";

export interface AppConfig {
  sessionSecret: string;
  adminPasswordHash: string;
  databasePath: string;
  appOrigin: string;
  secureCookies: boolean;
  apkBin: string;
  baseVersion: string;
  buildAdapter: "github" | "fake";
  buildWorkflow: string;
  buildRef: string;
  buildRepo: string;
  buildRepoToken: string;
}

export class ConfigError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid configuration:\n- ${issues.join("\n- ")}`);
    this.name = "ConfigError";
    this.issues = issues;
  }
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const issues: string[] = [];

  const sessionSecret = env.SESSION_SECRET?.trim() ?? "";
  if (!sessionSecret) {
    issues.push("SESSION_SECRET is required. Generate one with: openssl rand -base64 48");
  } else if (sessionSecret.length < 32) {
    issues.push(`SESSION_SECRET must be at least 32 characters (got ${sessionSecret.length}).`);
  }

  const adminPasswordHash = env.ADMIN_PASSWORD_HASH?.trim() ?? "";
  if (!adminPasswordHash) {
    issues.push("ADMIN_PASSWORD_HASH is required. Generate one with: npm run hash-password -- 'your-password'");
  } else if (!PASSWORD_HASH_PATTERN.test(adminPasswordHash)) {
    issues.push(
      "ADMIN_PASSWORD_HASH must use the scrypt$<salt>$<hash> format. Regenerate it with: npm run hash-password -- 'your-password'",
    );
  }

  const databasePath = env.DATABASE_PATH?.trim() || "./data/combinewrt.db";
  const appOrigin = env.APP_ORIGIN?.trim() || "http://localhost:3000";
  let secureCookies = false;
  try {
    const origin = new URL(appOrigin);
    if (origin.protocol !== "http:" && origin.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
    secureCookies = origin.protocol === "https:";
  } catch {
    issues.push("APP_ORIGIN must be a valid http:// or https:// URL");
  }

  const buildAdapter = env.BUILD_ADAPTER?.trim() || "fake";
  if (buildAdapter !== "github" && buildAdapter !== "fake") {
    issues.push("BUILD_ADAPTER must be either github or fake");
  }

  const buildWorkflow = env.BUILD_WORKFLOW?.trim() || "build.yml";
  if (!/^[A-Za-z0-9._-]+$/.test(buildWorkflow)) {
    issues.push("BUILD_WORKFLOW must be a workflow file name such as build.yml");
  }
  const buildRef = env.BUILD_REF?.trim() || "main";
  const buildRepo = env.BUILD_REPO?.trim() || "";
  const buildRepoToken = env.BUILD_REPO_TOKEN?.trim() || "";
  if (buildAdapter === "github") {
    if (!/^[^/\s]+\/[^/\s]+$/.test(buildRepo)) {
      issues.push("BUILD_REPO must be owner/repo when BUILD_ADAPTER=github");
    }
    if (!buildRepoToken) {
      issues.push("BUILD_REPO_TOKEN is required when BUILD_ADAPTER=github (a PAT with actions:write)");
    }
  }

  if (issues.length > 0) {
    throw new ConfigError(issues);
  }

  const apkBin = env.APK_BIN?.trim() || "apk";
  const baseVersion = env.IMMORTALWRT_BASE_VERSION?.trim() || "25.12.2";

  return {
    sessionSecret,
    adminPasswordHash,
    databasePath,
    appOrigin,
    secureCookies,
    apkBin,
    baseVersion,
    buildAdapter: buildAdapter as "github" | "fake",
    buildWorkflow,
    buildRef,
    buildRepo,
    buildRepoToken,
  };
}

let cached: AppConfig | undefined;

export function getConfig(): AppConfig {
  cached ??= loadConfig();
  return cached;
}
