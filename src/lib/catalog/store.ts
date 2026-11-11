import type { DatabaseSync } from "node:sqlite";
import type {
  CatalogPackage,
  CatalogProfile,
  ImageFormatId,
  PackageSearch,
  PackageSearchOptions,
  SnapshotInput,
  SnapshotMeta,
} from "./types";

interface SnapshotRow {
  id: number;
  base_version: string;
  feed_commit: string;
  source_note: string;
  created_at: string;
  profile_count: number;
  package_count: number;
}

interface PackageRow {
  name: string;
  version: string;
  arch: string;
  description: string;
  license: string | null;
  origin: string | null;
  category: string;
  installed_size: number;
  depends: string;
  feed: string;
  proprietary: number;
}

function toMeta(row: SnapshotRow): SnapshotMeta {
  return {
    id: row.id,
    baseVersion: row.base_version,
    feedCommit: row.feed_commit,
    sourceNote: row.source_note,
    createdAt: row.created_at,
    profileCount: row.profile_count,
    packageCount: row.package_count,
  };
}

function toPackage(row: PackageRow): CatalogPackage {
  return {
    name: row.name,
    version: row.version,
    arch: row.arch,
    description: row.description,
    license: row.license,
    origin: row.origin,
    category: row.category,
    installedSize: row.installed_size,
    depends: JSON.parse(row.depends) as string[],
    feed: row.feed,
    proprietary: row.proprietary === 1,
  };
}

export interface CatalogStore {
  findSnapshot(baseVersion: string, feedCommit: string): SnapshotMeta | null;
  getActiveSnapshot(): SnapshotMeta | null;
  saveSnapshot(input: SnapshotInput): SnapshotMeta;
  listProfiles(snapshotId: number): CatalogProfile[];
  searchPackages(snapshotId: number, options: PackageSearchOptions): PackageSearch;
  getPackage(snapshotId: number, name: string): CatalogPackage | null;
  listCategories(snapshotId: number): string[];
}

export function createCatalogStore(db: DatabaseSync): CatalogStore {
  function findSnapshot(baseVersion: string, feedCommit: string): SnapshotMeta | null {
    const row = db
      .prepare("SELECT * FROM catalog_snapshots WHERE base_version = ? AND feed_commit = ?")
      .get(baseVersion, feedCommit) as SnapshotRow | undefined;
    return row ? toMeta(row) : null;
  }

  function getActiveSnapshot(): SnapshotMeta | null {
    const pointer = db
      .prepare("SELECT value FROM app_meta WHERE key = 'catalog.active_snapshot'")
      .get() as { value: string } | undefined;
    if (!pointer) return null;
    const row = db.prepare("SELECT * FROM catalog_snapshots WHERE id = ?").get(Number(pointer.value)) as
      | SnapshotRow
      | undefined;
    return row ? toMeta(row) : null;
  }

  function saveSnapshot(input: SnapshotInput): SnapshotMeta {
    const existing = findSnapshot(input.baseVersion, input.feedCommit);
    if (existing) return existing;

    db.exec("BEGIN");
    try {
      const result = db
        .prepare(
          `INSERT INTO catalog_snapshots
             (base_version, feed_commit, source_note, profile_count, package_count)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(input.baseVersion, input.feedCommit, input.sourceNote, input.profiles.length, input.packages.length);
      const snapshotId = Number(result.lastInsertRowid);

      const insertProfile = db.prepare(
        "INSERT INTO catalog_profiles (snapshot_id, profile_id, title, formats, image_count) VALUES (?, ?, ?, ?, ?)",
      );
      for (const profile of input.profiles) {
        insertProfile.run(snapshotId, profile.id, profile.title, JSON.stringify(profile.formats), profile.imageCount);
      }

      const insertPackage = db.prepare(
        `INSERT INTO catalog_packages
           (snapshot_id, name, version, arch, description, license, origin, category,
            installed_size, depends, feed, proprietary)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const pkg of input.packages) {
        insertPackage.run(
          snapshotId,
          pkg.name,
          pkg.version,
          pkg.arch,
          pkg.description,
          pkg.license,
          pkg.origin,
          pkg.category,
          pkg.installedSize,
          JSON.stringify(pkg.depends),
          pkg.feed,
          pkg.proprietary ? 1 : 0,
        );
      }

      db.prepare(
        `INSERT INTO app_meta (key, value) VALUES ('catalog.active_snapshot', ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      ).run(String(snapshotId));

      db.exec("COMMIT");
      const saved = findSnapshot(input.baseVersion, input.feedCommit);
      if (!saved) throw new Error("snapshot was not persisted");
      return saved;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function listProfiles(snapshotId: number): CatalogProfile[] {
    const rows = db
      .prepare(
        "SELECT profile_id, title, formats, image_count FROM catalog_profiles WHERE snapshot_id = ? ORDER BY profile_id",
      )
      .all(snapshotId) as Array<{ profile_id: string; title: string; formats: string; image_count: number }>;
    return rows.map((row) => ({
      id: row.profile_id,
      title: row.title,
      formats: JSON.parse(row.formats) as ImageFormatId[],
      imageCount: row.image_count,
    }));
  }

  function searchPackages(snapshotId: number, options: PackageSearchOptions): PackageSearch {
    const query = options.query?.trim() ?? "";
    const category = options.category?.trim() ?? "";
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const offset = Math.max(options.offset ?? 0, 0);

    const where: string[] = ["snapshot_id = ?"];
    const params: Array<string | number> = [snapshotId];
    if (query) {
      const escaped = query.replace(/[\\%_]/g, (char) => `\\${char}`);
      where.push("(name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')");
      params.push(`%${escaped}%`, `%${escaped}%`);
    }
    if (category) {
      where.push("category = ?");
      params.push(category);
    }
    const whereSql = where.join(" AND ");

    const total = Number(
      (db.prepare(`SELECT COUNT(*) AS count FROM catalog_packages WHERE ${whereSql}`).get(...params) as {
        count: number;
      }).count,
    );
    const rows = db
      .prepare(`SELECT * FROM catalog_packages WHERE ${whereSql} ORDER BY name LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as unknown as PackageRow[];
    return { items: rows.map(toPackage), total };
  }

  function getPackage(snapshotId: number, name: string): CatalogPackage | null {
    const row = db
      .prepare("SELECT * FROM catalog_packages WHERE snapshot_id = ? AND name = ?")
      .get(snapshotId, name) as PackageRow | undefined;
    return row ? toPackage(row) : null;
  }

  function listCategories(snapshotId: number): string[] {
    const rows = db
      .prepare("SELECT DISTINCT category FROM catalog_packages WHERE snapshot_id = ? ORDER BY category")
      .all(snapshotId) as Array<{ category: string }>;
    return rows.map((row) => row.category);
  }

  return { findSnapshot, getActiveSnapshot, saveSnapshot, listProfiles, searchPackages, getPackage, listCategories };
}
