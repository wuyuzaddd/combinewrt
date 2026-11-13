import { dirname, join } from "node:path";
import { PASSWORD_HASH_PATTERN } from "./auth/password-format";

export interface AppConfig {
  sessionSecret: string;
  adminPasswordHash: string;
  databasePath: string;
  appOrigin: string;
  secureCookies: boolean;
  apkBin: string;
  baseVersion: string;
  dllkidsFeedUrl: string;
  dllkidsIndexSha256: string;
  supplementFeedUrl: string;
  supplementKeyUrl: string;
  supplementFeedCommit: string | null;
  supplementKeyFingerprint: string;
  buildAdapter: "github" | "fake";
  buildWorkflow: string;
  buildRepo: string;
  buildRepoToken: string;
  artifactCacheDir: string;
  artifactRetentionDays: number;
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
  const artifactRetentionDays = Number(env.ARTIFACT_RETENTION_DAYS?.trim() || "7");
  if (!Number.isInteger(artifactRetentionDays) || artifactRetentionDays < 0 || artifactRetentionDays > 365) {
    issues.push("ARTIFACT_RETENTION_DAYS must be an integer between 0 and 365");
  }
  const artifactCacheDir = env.ARTIFACT_CACHE_DIR?.trim() || join(dirname(databasePath), "artifacts");
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

  const apkBin = env.APK_BIN?.trim() || "apk";
  const baseVersion = env.IMMORTALWRT_BASE_VERSION?.trim() || "25.12.2";
  const dllkidsFeedUrl =
    env.DLLKIDS_FEED_URL?.trim() || "https://down.dllkids.xyz/openwrt-feed/25.12/x86_64";
  const dllkidsIndexSha256 =
    env.DLLKIDS_INDEX_SHA256?.trim() || "04a549ed7028b126218002b126cbc60eb3a4bdc3463f15425bce3ba6b91a04ba";
  if (!/^https?:\/\//.test(dllkidsFeedUrl)) {
    issues.push("DLLKIDS_FEED_URL must be an http:// or https:// URL");
  }
  if (!/^[0-9a-f]{64}$/.test(dllkidsIndexSha256)) {
    issues.push("DLLKIDS_INDEX_SHA256 must be a 64 character lowercase sha256");
  }
  const supplementFeedUrl =
    env.SUPPLEMENT_FEED_URL?.trim() || "https://wuyuzaddd.github.io/combinewrt-packages/x86_64";
  const supplementKeyUrl =
    env.SUPPLEMENT_KEY_URL?.trim() ||
    "https://wuyuzaddd.github.io/combinewrt-packages/keys/combinewrt-feed.pub.pem";
  if (!/^https?:\/\//.test(supplementFeedUrl)) {
    issues.push("SUPPLEMENT_FEED_URL must be an http:// or https:// URL");
  }
  if (!/^https?:\/\//.test(supplementKeyUrl)) {
    issues.push("SUPPLEMENT_KEY_URL must be an http:// or https:// URL");
  }
  const supplementFeedCommit = env.SUPPLEMENT_FEED_COMMIT?.trim() || null;
  if (supplementFeedCommit && !/^[0-9a-f]{40}$/.test(supplementFeedCommit)) {
    issues.push("SUPPLEMENT_FEED_COMMIT must be a 40 character lowercase git commit or empty");
  }
  const supplementKeyFingerprint =
    env.SUPPLEMENT_KEY_FINGERPRINT?.trim() ||
    "f71286670f3cc138ec4f55e650c6aa4ed2bd7fff7d29851aef2ac53bae72d083";
  if (!/^[0-9a-f]{64}$/.test(supplementKeyFingerprint)) {
    issues.push("SUPPLEMENT_KEY_FINGERPRINT must be a 64 character lowercase sha256");
  }

  if (issues.length > 0) {
    throw new ConfigError(issues);
  }

  return {
    sessionSecret,
    adminPasswordHash,
    databasePath,
    appOrigin,
    secureCookies,
    apkBin,
    baseVersion,
    dllkidsFeedUrl,
    dllkidsIndexSha256,
    supplementFeedUrl,
    supplementKeyUrl,
    supplementFeedCommit,
    supplementKeyFingerprint,
    buildAdapter: buildAdapter as "github" | "fake",
    buildWorkflow,
    buildRepo,
    buildRepoToken,
    artifactCacheDir,
    artifactRetentionDays,
  };
}

let cached: AppConfig | undefined;

export function getConfig(): AppConfig {
  cached ??= loadConfig();
  return cached;
}
