export interface Migration {
  version: string;
  sql: string;
  /**
   * Some migrations have to rebuild a table that other tables reference.
   * Turning foreign keys off during that migration keeps ON DELETE CASCADE
   * from silently deleting child rows when the old table is dropped.
   */
  disableForeignKeys?: boolean;
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
  {
    version: "008_build_failure",
    sql: `ALTER TABLE builds ADD COLUMN failure_json TEXT;`,
  },
  {
    version: "009_build_events",
    sql: `CREATE TABLE build_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      build_id TEXT NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
      from_status TEXT,
      to_status TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX build_events_build_id ON build_events(build_id, id);`,
  },
  {
    version: "010_v2_domain",
    // Rebuilding catalog_snapshots drops the old table; foreign keys must be
    // off or catalog_profiles / catalog_packages would cascade-delete.
    disableForeignKeys: true,
    sql: `
      ALTER TABLE base_versions ADD COLUMN channel TEXT NOT NULL DEFAULT 'release';

      CREATE TABLE catalog_snapshots_next (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        base_version TEXT NOT NULL,
        target TEXT NOT NULL DEFAULT 'x86/64',
        feed_commit TEXT NOT NULL,
        source_note TEXT NOT NULL,
        source_pins TEXT NOT NULL DEFAULT '{"official":{},"dllkids":null,"supplement":null,"kernel":null}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        profile_count INTEGER NOT NULL,
        package_count INTEGER NOT NULL,
        UNIQUE (base_version, target, feed_commit)
      );

      INSERT INTO catalog_snapshots_next
        (id, base_version, target, feed_commit, source_note, source_pins, created_at, profile_count, package_count)
      SELECT id, base_version, 'x86/64', feed_commit, source_note, source_pins, created_at, profile_count, package_count
      FROM catalog_snapshots;

      DROP TABLE catalog_snapshots;
      ALTER TABLE catalog_snapshots_next RENAME TO catalog_snapshots;
    `,
  },
  {
    version: "011_source_watch",
    sql: `
      CREATE TABLE source_pins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'candidate')),
        value TEXT NOT NULL,
        observed_at TEXT,
        adopted_at TEXT,
        adopted_by TEXT,
        cache_path TEXT,
        cache_sha256 TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        UNIQUE (source, status)
      );

      CREATE TABLE source_pin_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        from_pin TEXT,
        to_pin TEXT,
        reason TEXT NOT NULL,
        snapshot_id INTEGER REFERENCES catalog_snapshots(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX source_pin_events_source ON source_pin_events (source, id);

      CREATE TABLE source_watch_state (
        source TEXT PRIMARY KEY,
        last_check_at TEXT,
        last_success_at TEXT,
        last_error TEXT,
        candidate_reason TEXT,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    version: "050_supplement_publish",
    // One row per (base_version, source_commit) so a watch tick, a webhook and
    // a manual check can never dispatch the same candidate twice; retries and
    // staging->live promotions append to supplement_publish_events instead of
    // inserting a second row.
    sql: `
      CREATE TABLE supplement_publishes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        base_version TEXT NOT NULL,
        target TEXT NOT NULL,
        source_commit TEXT NOT NULL,
        recipe_hash TEXT NOT NULL,
        spdx TEXT NOT NULL,
        public_allowed INTEGER NOT NULL,
        package_set_shape TEXT NOT NULL,
        metadata_fingerprint TEXT NOT NULL,
        publish_mode TEXT NOT NULL CHECK (publish_mode IN ('live', 'staging')),
        gate_reason TEXT NOT NULL,
        trigger TEXT NOT NULL CHECK (trigger IN ('schedule', 'webhook', 'manual')),
        build_run_id TEXT,
        build_run_url TEXT,
        status TEXT NOT NULL CHECK (status IN (
          'dispatched', 'running', 'published', 'staged', 'failed', 'publish_pending'
        )),
        reason TEXT,
        index_sha256 TEXT,
        key_fingerprint TEXT,
        frozen_path TEXT,
        promoted_at TEXT,
        promoted_by TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (base_version, source_commit)
      );

      CREATE INDEX supplement_publishes_status ON supplement_publishes (status, updated_at);

      CREATE TABLE supplement_publish_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        publish_id INTEGER NOT NULL REFERENCES supplement_publishes(id) ON DELETE CASCADE,
        from_status TEXT,
        to_status TEXT NOT NULL,
        reason TEXT,
        detail_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE INDEX supplement_publish_events_publish ON supplement_publish_events (publish_id, id);
    `,
  },
  {
    version: "120_build_queue",
    // Ticket 13: SQLite is the only build queue. `status = 'queued'` means the
    // build is waiting for a dispatch slot; `dispatched_at` records when it left
    // the queue (the dispatch attempt), and `engine`/`target` keep the dispatch
    // decision visible without re-reading the plan JSON. All columns are
    // nullable so V1 rows stay readable.
    sql: `
      ALTER TABLE builds ADD COLUMN engine TEXT;
      ALTER TABLE builds ADD COLUMN target TEXT;
      ALTER TABLE builds ADD COLUMN dispatched_at TEXT;

      CREATE INDEX IF NOT EXISTS builds_queue ON builds (status, created_at);
    `,
  },
  {
    version: "130_artifact_cache",
    // Site artifact cache index (ticket 14). Files on disk stay authoritative:
    // the index is reconciled against them on startup and after every cleanup,
    // so a crash between rename and upsert is repaired rather than served.
    sql: `
      CREATE TABLE IF NOT EXISTS artifact_cache_entries (
        build_id TEXT NOT NULL,
        filename TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        kind TEXT NOT NULL,
        size INTEGER NOT NULL CHECK (size >= 0),
        sha256 TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (build_id, filename)
      );

      CREATE INDEX IF NOT EXISTS artifact_cache_entries_updated
        ON artifact_cache_entries (updated_at);
    `,
  },
  {
    version: "140_build_dispatch_payload",
    // Row 11 fix (2026-11-18): a build that waits behind MAX_CONCURRENT_BUILDS
    // must dispatch from the reconciler pump, possibly in a fresh process. The
    // full plan (generated file contents + typed network secrets) is sealed
    // with AES-256-GCM under a key derived from SESSION_SECRET; `plan_json`
    // stays redacted. Legacy rows have NULL here and are either secret-free or
    // fail loudly at dispatch instead of building without their overlay.
    sql: `ALTER TABLE builds ADD COLUMN dispatch_payload TEXT;`,
  },
  {
    version: "150_artifact_container",
    // Ticket 13 (2026-11-21): the download route serves the GitHub artifact ZIP
    // container, not the image inside it. `artifact_sha256`/`artifact_size` keep
    // describing the image (the manifest facts); these two columns describe the
    // bytes the browser actually receives, so the response headers can be true
    // and verified without unpacking.
    sql: `
      ALTER TABLE builds ADD COLUMN artifact_container_sha256 TEXT;
      ALTER TABLE builds ADD COLUMN artifact_container_size INTEGER;
    `,
  },
];
