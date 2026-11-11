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
  return db;
}

export function migrate(db: DatabaseSync, migrations: Migration[] = MIGRATIONS): string[] {
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

    db.exec("BEGIN");
    try {
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, datetime('now'))").run(
        migration.version,
      );
      db.exec("COMMIT");
      appliedNow.push(migration.version);
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
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
