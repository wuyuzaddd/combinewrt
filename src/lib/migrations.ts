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
  {
    version: "004_build_artifact_metadata",
    sql: `
      ALTER TABLE builds ADD COLUMN artifact_sha256 TEXT;
      ALTER TABLE builds ADD COLUMN artifact_size INTEGER;
    `,
  },
  {
    version: "005_build_config",
    sql: `ALTER TABLE builds ADD COLUMN config_json TEXT;`,
  },
  {
    version: "006_package_sources",
    sql: `
      CREATE TABLE catalog_packages_next (
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
        source TEXT NOT NULL DEFAULT 'official',
        source_pin TEXT NOT NULL DEFAULT '',
        sha256 TEXT,
        file_size INTEGER NOT NULL DEFAULT 0,
        filename TEXT,
        download_url TEXT,
        kmod INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (snapshot_id, name, source)
      );

      INSERT INTO catalog_packages_next
        (snapshot_id, name, version, arch, description, license, origin, category,
         installed_size, depends, feed, proprietary, source, source_pin, sha256,
         file_size, filename, download_url, kmod)
      SELECT snapshot_id, name, version, arch, description, license, origin, category,
             installed_size, depends, feed, proprietary, 'official', '', NULL,
             0, NULL, NULL, CASE WHEN name LIKE 'kmod-%' THEN 1 ELSE 0 END
      FROM catalog_packages;

      DROP TABLE catalog_packages;
      ALTER TABLE catalog_packages_next RENAME TO catalog_packages;

      CREATE INDEX catalog_packages_category
        ON catalog_packages (snapshot_id, category);

      ALTER TABLE catalog_snapshots
        ADD COLUMN source_pins TEXT NOT NULL DEFAULT '{"official":{},"dllkids":null,"supplement":null,"kernel":null}';
    `,
  },
  {
    version: "007_base_versions",
    sql: `
      CREATE TABLE IF NOT EXISTS base_versions (
        version TEXT PRIMARY KEY,
        release_date TEXT,
        image_builder_url TEXT NOT NULL,
        image_builder_sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      INSERT INTO base_versions (version, release_date, image_builder_url, image_builder_sha256)
      VALUES (
        '25.12.2',
        '2026-09-08',
        'https://downloads.immortalwrt.org/releases/25.12.2/targets/x86/64/immortalwrt-imagebuilder-25.12.2-x86-64.Linux-x86_64.tar.zst',
        'b9b290f5ef60a22bccd5bdca9c1e7523b8fc84e60462afbf550e20db94acf2c6'
      )
      ON CONFLICT (version) DO NOTHING;

      INSERT INTO app_meta (key, value) VALUES ('base.active', '25.12.2')
      ON CONFLICT (key) DO NOTHING;
    `,
  },
];
