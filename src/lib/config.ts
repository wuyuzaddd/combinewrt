import { dirname, join } from "node:path";
import { PASSWORD_HASH_PATTERN } from "./auth/password-format";
import {
  DEFAULT_DLLKIDS_FEED_URL,
  DEFAULT_DLLKIDS_INDEX_SHA256,
  DEFAULT_FEED_BASE_URL,
  DEFAULT_FEED_KEY_FINGERPRINT,
  DEFAULT_FEED_KEY_URL,
  OFFICIAL_FEED_BASE,
  type ResolvedImageFeedOptions,
} from "./build/feeds";

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
  /** Project image feed set configuration (ticket 09). */
  imageFeed: ImageFeedConfig;
  /**
   * Upstream repository the supplement packages are rebuilt from. The watch
   * observes its `supplementSourceRef` head and dispatches a build for that
   * exact commit (ADR 0008).
   */
  supplementSourceRepo: string;
  supplementSourceRef: string;
  /** Target id the supplement feed publishes for (`x86_64`). */
  supplementTarget: string;
  /** Live publish audit record written by the feed repo. */
  supplementPublishAuditUrl: string;
  /** Staging publish audit record written by the feed repo. */
  supplementStagingAuditUrl: string;
  /** Whether the supplement watch dispatches builds on commit changes. */
  supplementWatchEnabled: boolean;
  buildAdapter: "github" | "fake";
  buildWorkflow: string;
  supplementWorkflow: string;
  buildRepo: string;
  buildRepoToken: string;
  /** Branch or tag the build workflows run on (default: main). */
  buildRef: string;
  artifactCacheDir: string;
  artifactRetentionDays: number;
  sourceWatchIntervalHours: number;
  sourceCacheDir: string;
}

export class ConfigError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid configuration:\n- ${issues.join("\n- ")}`);
    this.name = "ConfigError";
    this.issues = issues;
  }
}

/**
 * Image feed set configuration (ticket 09): the official base (or
 * `IMMORTALWRT_MIRROR` override) plus the project supplement/extension feeds.
 */
export type ImageFeedConfig = ResolvedImageFeedOptions;

function parseImageFeedConfig(
  env: Record<string, string | undefined>,
  issues: string[],
): ImageFeedConfig {
  const mirrorRaw = env.IMMORTALWRT_MIRROR?.trim() ?? "";
  let officialMirror: string | null = null;
  if (mirrorRaw) {
    if (!/^https?:\/\//.test(mirrorRaw)) {
      issues.push("IMMORTALWRT_MIRROR must be an http:// or https:// URL");
    } else {
      officialMirror = mirrorRaw.replace(/\/+$/, "");
    }
  }

  const feedBaseUrl = (env.COMBINEWRT_FEED_BASE_URL?.trim() || DEFAULT_FEED_BASE_URL).replace(/\/+$/, "");
  if (!/^https?:\/\//.test(feedBaseUrl)) {
    issues.push("COMBINEWRT_FEED_BASE_URL must be an http:// or https:// URL");
  }

  const keyUrl = env.SUPPLEMENT_KEY_URL?.trim() || DEFAULT_FEED_KEY_URL;
  if (!/^https?:\/\//.test(keyUrl)) {
    issues.push("SUPPLEMENT_KEY_URL must be an http:// or https:// URL");
  }

  const keyFingerprint = env.SUPPLEMENT_KEY_FINGERPRINT?.trim() || DEFAULT_FEED_KEY_FINGERPRINT;
  if (!/^[0-9a-f]{64}$/.test(keyFingerprint)) {
    issues.push("SUPPLEMENT_KEY_FINGERPRINT must be a 64 character lowercase sha256");
  }

  const optionalSha = (raw: string | undefined, name: string): string | null => {
    const value = raw?.trim() ?? "";
    if (!value) return null;
    if (!/^[0-9a-f]{64}$/.test(value)) {
      issues.push(`${name} must be a 64 character lowercase sha256 or empty`);
      return null;
    }
    return value;
  };

  const dllkidsFeedUrl = env.DLLKIDS_FEED_URL?.trim() || DEFAULT_DLLKIDS_FEED_URL;
  if (!/^https?:\/\//.test(dllkidsFeedUrl)) {
    issues.push("DLLKIDS_FEED_URL must be an http:// or https:// URL");
  }
  const dllkidsIndexSha256 = env.DLLKIDS_INDEX_SHA256?.trim() || DEFAULT_DLLKIDS_INDEX_SHA256;
  if (!/^[0-9a-f]{64}$/.test(dllkidsIndexSha256)) {
    issues.push("DLLKIDS_INDEX_SHA256 must be a 64 character lowercase sha256");
  }

  return {
    officialBaseUrl: officialMirror ?? OFFICIAL_FEED_BASE,
    officialMirror,
    feedBaseUrl,
    keyUrl,
    keyFingerprint,
    supplementIndexSha256: optionalSha(env.SUPPLEMENT_INDEX_SHA256, "SUPPLEMENT_INDEX_SHA256"),
    extensionIndexSha256: optionalSha(env.EXTENSION_INDEX_SHA256, "EXTENSION_INDEX_SHA256"),
    dllkidsFeedUrl,
    dllkidsIndexSha256,
  };
}

/**
 * Read only the image feed variables. Kept separate from `loadConfig` so plan
 * preparation does not require the full session/build environment (route tests
 * deliberately do not set SESSION_SECRET).
 */
export function loadImageFeedConfig(
  env: Record<string, string | undefined> = process.env,
): ImageFeedConfig {
  const issues: string[] = [];
  const config = parseImageFeedConfig(env, issues);
  if (issues.length > 0) throw new ConfigError(issues);
  return config;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const issues: string[] = [];
  const imageFeed = parseImageFeedConfig(env, issues);

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
  const supplementWorkflow = env.SUPPLEMENT_WORKFLOW?.trim() || "packages.yml";
  if (!/^[A-Za-z0-9._-]+$/.test(supplementWorkflow)) {
    issues.push("SUPPLEMENT_WORKFLOW must be a workflow file name such as packages.yml");
  }
  const artifactRetentionDays = Number(env.ARTIFACT_RETENTION_DAYS?.trim() || "7");
  if (!Number.isInteger(artifactRetentionDays) || artifactRetentionDays < 0 || artifactRetentionDays > 365) {
    issues.push("ARTIFACT_RETENTION_DAYS must be an integer between 0 and 365");
  }
  const artifactCacheDir = env.ARTIFACT_CACHE_DIR?.trim() || join(dirname(databasePath), "artifacts");
  const sourceWatchIntervalHours = Number(env.SOURCE_WATCH_INTERVAL_HOURS?.trim() || "6");
  if (
    !Number.isInteger(sourceWatchIntervalHours) ||
    sourceWatchIntervalHours < 1 ||
    sourceWatchIntervalHours > 168
  ) {
    issues.push("SOURCE_WATCH_INTERVAL_HOURS must be an integer between 1 and 168");
  }
  const sourceCacheDir =
    env.SOURCE_CACHE_DIR?.trim() || join(dirname(databasePath), "source-cache");
  const buildRef = env.BUILD_REF?.trim() || "main";
  if (!/^[A-Za-z0-9._/-]+$/.test(buildRef)) {
    issues.push("BUILD_REF must be a branch or tag name");
  }
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
  const dllkidsFeedUrl = imageFeed.dllkidsFeedUrl;
  const dllkidsIndexSha256 = imageFeed.dllkidsIndexSha256;
  // Live supplement channel: version-scoped, but always the current index for
  // this base version. The feed repo also keeps the V1 flat `/x86_64/` copy.
  const supplementFeedUrl =
    env.SUPPLEMENT_FEED_URL?.trim() ||
    `https://wuyuzaddd.github.io/combinewrt-packages/supplement/${baseVersion}/x86_64`;
  const supplementKeyUrl = imageFeed.keyUrl;
  if (!/^https?:\/\//.test(supplementFeedUrl)) {
    issues.push("SUPPLEMENT_FEED_URL must be an http:// or https:// URL");
  }
  const supplementFeedCommit = env.SUPPLEMENT_FEED_COMMIT?.trim() || null;
  if (supplementFeedCommit && !/^[0-9a-f]{40}$/.test(supplementFeedCommit)) {
    issues.push("SUPPLEMENT_FEED_COMMIT must be a 40 character lowercase git commit or empty");
  }
  const supplementKeyFingerprint = imageFeed.keyFingerprint;
  const supplementSourceRepo = env.SUPPLEMENT_SOURCE_REPO?.trim() || "kiddin9/op-packages";
  if (!/^[^/\s]+\/[^/\s]+$/.test(supplementSourceRepo)) {
    issues.push("SUPPLEMENT_SOURCE_REPO must be owner/repo");
  }
  const supplementSourceRef = env.SUPPLEMENT_SOURCE_REF?.trim() || "main";
  if (!/^[A-Za-z0-9._/-]+$/.test(supplementSourceRef)) {
    issues.push("SUPPLEMENT_SOURCE_REF must be a branch, tag or 40 character commit");
  }
  const supplementTarget = env.SUPPLEMENT_TARGET?.trim() || "x86_64";
  if (!/^[A-Za-z0-9._-]+$/.test(supplementTarget)) {
    issues.push("SUPPLEMENT_TARGET must be a target id such as x86_64");
  }
  const supplementPublishAuditUrl =
    env.SUPPLEMENT_PUBLISH_AUDIT_URL?.trim() ||
    "https://wuyuzaddd.github.io/combinewrt-packages/publish.json";
  const supplementStagingAuditUrl =
    env.SUPPLEMENT_STAGING_AUDIT_URL?.trim() ||
    "https://wuyuzaddd.github.io/combinewrt-packages/staging.json";
  if (!/^https?:\/\//.test(supplementPublishAuditUrl)) {
    issues.push("SUPPLEMENT_PUBLISH_AUDIT_URL must be an http:// or https:// URL");
  }
  if (!/^https?:\/\//.test(supplementStagingAuditUrl)) {
    issues.push("SUPPLEMENT_STAGING_AUDIT_URL must be an http:// or https:// URL");
  }
  const supplementWatchEnabled = (env.SUPPLEMENT_WATCH_ENABLED?.trim() || "true") !== "false";

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
    imageFeed,
    supplementSourceRepo,
    supplementSourceRef,
    supplementTarget,
    supplementPublishAuditUrl,
    supplementStagingAuditUrl,
    supplementWatchEnabled,
    buildAdapter: buildAdapter as "github" | "fake",
    buildWorkflow,
    supplementWorkflow,
    buildRepo,
    buildRepoToken,
    buildRef,
    artifactCacheDir,
    artifactRetentionDays,
    sourceWatchIntervalHours,
    sourceCacheDir,
  };
}

let cached: AppConfig | undefined;

export function getConfig(): AppConfig {
  cached ??= loadConfig();
  return cached;
}
