import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getConfig } from "./config";
import { MIGRATIONS } from "./migrations";

export function openDatabase(path: string): DatabaseSync {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

export interface MigrateOptions {
  /** Apply migrations only through this version (inclusive). Used to build
   *  realistic pre-migration databases in tests. */
  upTo?: string;
}

export function migrate(db: DatabaseSync, options: MigrateOptions = {}): string[] {
  const through = options.upTo ? MIGRATIONS.findIndex((migration) => migration.version === options.upTo) : -1;
  if (options.upTo && through === -1) {
    throw new Error(`unknown migration ${options.upTo}`);
  }
  const migrations = options.upTo ? MIGRATIONS.slice(0, through + 1) : MIGRATIONS;

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

  const appliedNow: string[] = [];
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;

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
