export interface AppConfig {
  sessionSecret: string;
  adminPasswordHash: string;
  databasePath: string;
  appOrigin: string;
}

export class ConfigError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid configuration:\n- ${issues.join("\n- ")}`);
    this.name = "ConfigError";
    this.issues = issues;
  }
}

const PASSWORD_HASH_PATTERN = /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/;

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
  if (!/^https?:\/\//.test(appOrigin)) {
    issues.push("APP_ORIGIN must start with http:// or https://");
  }

  if (issues.length > 0) {
    throw new ConfigError(issues);
  }

  return { sessionSecret, adminPasswordHash, databasePath, appOrigin };
}

let cached: AppConfig | undefined;

export function getConfig(): AppConfig {
  cached ??= loadConfig();
  return cached;
}
