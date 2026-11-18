import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrate, openDatabase, validateMigrationOrder } from "./db";
import type { Migration } from "./migrations";

const dirs: string[] = [];

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "combinewrt-db-"));
  dirs.push(dir);
  return join(dir, "test.db");
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("database bootstrap", () => {
  it("creates the database file and applies migrations", () => {
    const db = openDatabase(tempDbPath());
    expect(migrate(db)).toEqual([
      "001_init",
      "002_catalog",
      "003_builds",
      "004_build_artifact_metadata",
      "005_build_config",
      "006_package_sources",
      "007_base_versions",
      "008_build_failure",
      "009_build_events",
      "010_v2_domain",
      "011_source_watch",
      "050_supplement_publish",
      "120_build_queue",
      "130_artifact_cache",
      "140_build_dispatch_payload",
    ]);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => String(row.name));
    expect(tables).toContain("schema_migrations");
    expect(tables).toContain("app_meta");
    db.close();
  });

  it("is idempotent across restarts", () => {
    const db = openDatabase(tempDbPath());
    migrate(db);
    expect(migrate(db)).toEqual([]);
    db.close();
  });

  it("migrates a populated V1 database to the V2 domain schema without losing rows", () => {
    const db = openDatabase(tempDbPath());
    expect(migrate(db, { upTo: "009_build_events" })).toHaveLength(9);

    db.prepare(
      `INSERT INTO catalog_snapshots
         (id, base_version, feed_commit, source_note, source_pins, profile_count, package_count)
       VALUES (7, '25.12.2', 'legacy-feed', 'fixture',
         '{"official":{"base":"abc"},"dllkids":null,"supplement":null,"kernel":null}', 1, 1)`,
    ).run();
    db.prepare(
      `INSERT INTO catalog_profiles (snapshot_id, profile_id, title, formats, image_count)
       VALUES (7, 'generic', 'Generic x86/64', '["ext4-efi"]', 25)`,
    ).run();
    db.prepare(
      `INSERT INTO catalog_packages
         (snapshot_id, name, version, arch, description, license, origin, category,
          installed_size, depends, feed, proprietary, source, source_pin, sha256,
          file_size, filename, download_url, kmod)
       VALUES (7, 'luci', '1.0', 'x86_64', 'web ui', NULL, NULL, 'luci', 2048,
         '[]', 'luci', 0, 'official', '', NULL, 0, 'luci-1.0.apk', NULL, 0)`,
    ).run();
    const legacyPlan = JSON.stringify({
      baseVersion: "25.12.2",
      feedCommit: "legacy-feed",
      profileId: "generic",
      imageType: "ext4-efi",
      artifactName: "legacy.img.gz",
    });
    db.prepare(
      `INSERT INTO builds (id, plan_json, status, adapter, log_tail, created_at, updated_at)
       VALUES ('build-legacy', ?, 'succeeded', 'fake', '', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z')`,
    ).run(legacyPlan);

    expect(migrate(db)).toEqual([
      "010_v2_domain",
      "011_source_watch",
      "050_supplement_publish",
      "120_build_queue",
      "130_artifact_cache",
      "140_build_dispatch_payload",
    ]);

    const snapshot = db.prepare("SELECT * FROM catalog_snapshots WHERE id = 7").get() as Record<string, unknown>;
    expect(snapshot).toMatchObject({
      id: 7,
      base_version: "25.12.2",
      feed_commit: "legacy-feed",
      target: "x86/64",
      profile_count: 1,
      package_count: 1,
    });
    expect(JSON.parse(String(snapshot.source_pins))).toEqual({
      official: { base: "abc" },
      dllkids: null,
      supplement: null,
      kernel: null,
    });
    expect(
      Number((db.prepare("SELECT COUNT(*) AS count FROM catalog_profiles WHERE snapshot_id = 7").get() as {
        count: number;
      }).count),
    ).toBe(1);
    expect(
      Number((db.prepare("SELECT COUNT(*) AS count FROM catalog_packages WHERE snapshot_id = 7").get() as {
        count: number;
      }).count),
    ).toBe(1);

    const base = db.prepare("SELECT channel FROM base_versions WHERE version = '25.12.2'").get() as {
      channel: string;
    };
    expect(base.channel).toBe("release");

    const build = db.prepare("SELECT plan_json FROM builds WHERE id = 'build-legacy'").get() as {
      plan_json: string;
    };
    expect((JSON.parse(build.plan_json) as { schemaVersion?: number }).schemaVersion).toBeUndefined();
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

    expect(() =>
      db
        .prepare(
          `INSERT INTO catalog_snapshots
             (base_version, target, feed_commit, source_note, source_pins, profile_count, package_count)
           VALUES ('25.12.2', 'x86/64', 'legacy-feed', 'duplicate', '{}', 0, 0)`,
        )
        .run(),
    ).toThrow(/UNIQUE/);

    const otherTarget = db
      .prepare(
        `INSERT INTO catalog_snapshots
           (base_version, target, feed_commit, source_note, source_pins, profile_count, package_count)
         VALUES ('25.12.2', 'armsr/armv8', 'legacy-feed', 'arm', '{}', 0, 0)`,
      )
      .run();
    expect(Number(otherTarget.lastInsertRowid)).toBeGreaterThan(7);
    db.close();
  });
});

describe("migration order contract", () => {
  const migration = (version: string): Migration => ({ version, sql: "SELECT 1;" });

  it("accepts the checked-in append-only list", () => {
    expect(() => validateMigrationOrder([migration("011_source_watch"), migration("050_foo"), migration("120_bar")])).not.toThrow();
  });

  it("rejects duplicate versions and versions that do not sort after the previous one", () => {
    expect(() => validateMigrationOrder([migration("011_a"), migration("011_a")])).toThrow(/duplicate/);
    // Versions jump by ticket block; an out-of-order insert must be caught.
    expect(() => validateMigrationOrder([migration("050_a"), migration("120_b"), migration("011_c")])).toThrow(/sort after/);
    expect(() => validateMigrationOrder([migration("m1")])).toThrow(/000_name/);
  });

  it("refuses a pending migration that sorts before an already-applied one", () => {
    const db = openDatabase(":memory:");
    const migrations = [migration("010_a"), migration("020_b"), migration("030_c")];
    const through = migrate(db, { migrations });
    expect(through).toEqual(["010_a", "020_b", "030_c"]);
    // Simulate merging a ticket block that was numbered earlier than a block a
    // database already applied: 025_x is pending but sorts before 030_c.
    expect(() =>
      migrate(db, { migrations: [migration("010_a"), migration("020_b"), migration("025_x"), migration("030_c")] }),
    ).toThrow(/sorts before the already-applied|must sort after/);
    db.close();
  });

  it("waits on a busy database instead of failing immediately", () => {
    const db = openDatabase(":memory:");
    const row = db.prepare("PRAGMA busy_timeout").get() as { timeout: number };
    expect(Number(row.timeout)).toBe(5000);
    db.close();
  });
});
