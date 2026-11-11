export interface Migration {
  version: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: "001_init",
    sql: `
      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      INSERT INTO app_meta (key, value)
      VALUES ('schema', '1')
      ON CONFLICT (key) DO NOTHING;
    `,
  },
  {
    version: "002_catalog",
    sql: `
      CREATE TABLE IF NOT EXISTS catalog_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        base_version TEXT NOT NULL,
        feed_commit TEXT NOT NULL,
        source_note TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        profile_count INTEGER NOT NULL,
        package_count INTEGER NOT NULL,
        UNIQUE (base_version, feed_commit)
      );

      CREATE TABLE IF NOT EXISTS catalog_profiles (
        snapshot_id INTEGER NOT NULL REFERENCES catalog_snapshots(id) ON DELETE CASCADE,
        profile_id TEXT NOT NULL,
        title TEXT NOT NULL,
        formats TEXT NOT NULL,
        image_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (snapshot_id, profile_id)
      );

      CREATE TABLE IF NOT EXISTS catalog_packages (
        snapshot_id INTEGER NOT NULL REFERENCES catalog_snapshots(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        version TEXT NOT NULL,
        arch TEXT NOT NULL,
        description TEXT NOT NULL,
        license TEXT,
        origin TEXT,
        category TEXT NOT NULL,
        installed_size INTEGER NOT NULL,
        depends TEXT NOT NULL,
        feed TEXT NOT NULL,
        proprietary INTEGER NOT NULL,
        PRIMARY KEY (snapshot_id, name)
      );

      CREATE INDEX IF NOT EXISTS catalog_packages_category
        ON catalog_packages (snapshot_id, category);
    `,
  },
  {
    version: "003_builds",
    sql: `
      CREATE TABLE IF NOT EXISTS builds (
        id TEXT PRIMARY KEY,
        plan_json TEXT NOT NULL,
        status TEXT NOT NULL,
        run_id TEXT,
        adapter TEXT NOT NULL,
        log_tail TEXT NOT NULL DEFAULT '',
        error TEXT,
        artifact_name TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS builds_created_at ON builds (created_at DESC);
    `,
  },
];
