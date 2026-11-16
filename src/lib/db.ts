import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getConfig } from "./config";
import { MIGRATIONS, type Migration } from "./migrations";

export function openDatabase(path: string): DatabaseSync {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  // Two processes (site + scheduler tick) can write at the same time; without a
  // busy timeout SQLITE_BUSY surfaces as a random 500 instead of waiting.
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}

export interface MigrateOptions {
  /** Apply migrations only through this version (inclusive). Used to build
   *  realistic pre-migration databases in tests. */
  upTo?: string;
  /** Test seam: replace the checked-in list. */
  migrations?: readonly Migration[];
}

const VERSION_RE = /^\d{3}_[a-z0-9_]+$/;

/**
 * Migrations are append-only and applied in array order, so the array itself is
 * the order contract. Version numbers jump (011 -> 050 -> 120 -> 130) by ticket
 * block, which makes an accidental out-of-order insert easy to miss; assert it
 * once instead of discovering it as a half-migrated database.
 */
export function validateMigrationOrder(migrations: readonly Migration[]): void {
  const seen = new Set<string>();
  let previous = "";
  for (const migration of migrations) {
    if (!VERSION_RE.test(migration.version)) {
      throw new Error(`migration version "${migration.version}" must look like 000_name`);
    }
    if (seen.has(migration.version)) {
      throw new Error(`duplicate migration ${migration.version}`);
    }
    if (previous && migration.version <= previous) {
      throw new Error(`migration ${migration.version} must sort after ${previous}`);
    }
    seen.add(migration.version);
    previous = migration.version;
  }
}

export function migrate(db: DatabaseSync, options: MigrateOptions = {}): string[] {
  const all = options.migrations ?? MIGRATIONS;
  validateMigrationOrder(all);
  const through = options.upTo ? all.findIndex((migration) => migration.version === options.upTo) : -1;
  if (options.upTo && through === -1) {
    throw new Error(`unknown migration ${options.upTo}`);
  }
  const migrations = options.upTo ? all.slice(0, through + 1) : all;

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const applied = new Set(
    db
      .prepare("SELECT version FROM schema_migrations")
      .all()
      .map((row) => String(row.version)),
  );

  const indexByVersion = new Map(all.map((migration, index) => [migration.version, index]));
  const appliedNow: string[] = [];
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    // A pending migration that sorts before anything already applied would make
    // the append-only order a lie (and could run against a newer schema).
    const currentIndex = indexByVersion.get(migration.version) ?? -1;
    for (const version of applied) {
      const appliedIndex = indexByVersion.get(version);
      if (appliedIndex !== undefined && appliedIndex > currentIndex) {
        throw new Error(
          `migration ${migration.version} sorts before the already-applied ${version}; refusing to apply out of order`,
        );
      }
    }

    if (migration.disableForeignKeys) db.exec("PRAGMA foreign_keys = OFF");
    try {
      db.exec("BEGIN");
      try {
        db.exec(migration.sql);
        if (migration.disableForeignKeys) {
          const violations = db.prepare("PRAGMA foreign_key_check").all();
          if (violations.length > 0) {
            throw new Error(
              `migration ${migration.version} left ${violations.length} foreign key violation(s)`,
            );
          }
        }
        db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, datetime('now'))").run(
          migration.version,
        );
        db.exec("COMMIT");
        appliedNow.push(migration.version);
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    } finally {
      if (migration.disableForeignKeys) db.exec("PRAGMA foreign_keys = ON");
    }
  }

  return appliedNow;
}

let instance: DatabaseSync | undefined;

export function getDatabase(): DatabaseSync {
  if (!instance) {
    const { databasePath } = getConfig();
    instance = openDatabase(databasePath);
    migrate(instance);
  }
  return instance;
}
