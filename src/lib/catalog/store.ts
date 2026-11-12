import type { DatabaseSync } from "node:sqlite";
import type {
  CatalogPackage,
  CatalogProfile,
  ImageFormatId,
  PackageSearch,
  PackageSearchOptions,
  PackageSource,
  SnapshotInput,
  SnapshotMeta,
  SourcePins,
} from "./types";
import { EMPTY_SOURCE_PINS, PACKAGE_SOURCES } from "./types";

interface SnapshotRow {
  id: number;
  base_version: string;
  feed_commit: string;
  source_note: string;
  source_pins: string | null;
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
  source: PackageSource;
  source_pin: string;
  sha256: string | null;
  file_size: number | null;
  filename: string | null;
  download_url: string | null;
  kmod: number;
}

const SOURCE_ORDER = `CASE source ${PACKAGE_SOURCES.map((source, index) => `WHEN '${source}' THEN ${index}`).join(" ")} ELSE ${PACKAGE_SOURCES.length} END`;

function parsePins(value: string | null): SourcePins {
  if (!value) return EMPTY_SOURCE_PINS;
  try {
    const parsed = JSON.parse(value) as Partial<SourcePins>;
    return {
      official: parsed.official ?? {},
      dllkids: parsed.dllkids ?? null,
      supplement: parsed.supplement ?? null,
      kernel: parsed.kernel ?? null,
    };
  } catch {
    return EMPTY_SOURCE_PINS;
  }
}

function toMeta(row: SnapshotRow): SnapshotMeta {
  return {
    id: row.id,
    baseVersion: row.base_version,
    feedCommit: row.feed_commit,
    sourceNote: row.source_note,
    sourcePins: parsePins(row.source_pins),
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
    source: row.source,
    sourcePin: row.source_pin,
    sha256: row.sha256,
    fileSize: row.file_size ?? 0,
    filename: row.filename,
    downloadUrl: row.download_url,
    kmod: row.kmod === 1,
  };
}

export interface CatalogStore {
  findSnapshot(baseVersion: string, feedCommit: string): SnapshotMeta | null;
  getActiveSnapshot(): SnapshotMeta | null;
  latestForBaseVersion(baseVersion: string): number | null;
  activateSnapshot(snapshotId: number): boolean;
  saveSnapshot(input: SnapshotInput): SnapshotMeta;
  listProfiles(snapshotId: number): CatalogProfile[];
  searchPackages(snapshotId: number, options: PackageSearchOptions): PackageSearch;
  getPackage(snapshotId: number, name: string): CatalogPackage | null;
  getPackageCandidates(snapshotId: number, name: string): CatalogPackage[];
  sourceCounts(snapshotId: number): Record<PackageSource, number>;
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

  function latestForBaseVersion(baseVersion: string): number | null {
    const row = db
      .prepare("SELECT id FROM catalog_snapshots WHERE base_version = ? ORDER BY created_at DESC, id DESC LIMIT 1")
      .get(baseVersion) as { id: number } | undefined;
    return row ? Number(row.id) : null;
  }

  function activateSnapshot(snapshotId: number): boolean {
    const row = db.prepare("SELECT id FROM catalog_snapshots WHERE id = ?").get(snapshotId) as
      | { id: number }
      | undefined;
    if (!row) return false;
    db.prepare(
      `INSERT INTO app_meta (key, value) VALUES ('catalog.active_snapshot', ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    ).run(String(snapshotId));
    return true;
  }

  function saveSnapshot(input: SnapshotInput): SnapshotMeta {
    const existing = findSnapshot(input.baseVersion, input.feedCommit);
    if (existing) return existing;

    db.exec("BEGIN");
    try {
      const result = db
        .prepare(
          `INSERT INTO catalog_snapshots
             (base_version, feed_commit, source_note, source_pins, profile_count, package_count)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.baseVersion,
          input.feedCommit,
          input.sourceNote,
          JSON.stringify(input.sourcePins),
          input.profiles.length,
          input.packages.length,
        );
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
            installed_size, depends, feed, proprietary, source, source_pin, sha256,
            file_size, filename, download_url, kmod)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          pkg.source,
          pkg.sourcePin,
          pkg.sha256,
          pkg.fileSize,
          pkg.filename,
          pkg.downloadUrl,
          pkg.kmod ? 1 : 0,
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

    const filters: string[] = [];
    const params: Array<string | number> = [];
    if (query) {
      const escaped = query.replace(/[\\%_]/g, (char) => `\\${char}`);
      filters.push("(name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')");
      params.push(`%${escaped}%`, `%${escaped}%`);
    }
    if (category) {
      filters.push("category = ?");
      params.push(category);
    }
    const filterSql = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const ranked = `WITH ranked AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY name ORDER BY ${SOURCE_ORDER}) AS rn
      FROM catalog_packages WHERE snapshot_id = ?
    ), winners AS (SELECT * FROM ranked WHERE rn = 1)`;

    const total = Number(
      (db.prepare(`${ranked} SELECT COUNT(*) AS count FROM winners ${filterSql}`).get(snapshotId, ...params) as {
        count: number;
      }).count,
    );
    const rows = db
      .prepare(`${ranked} SELECT * FROM winners ${filterSql} ORDER BY name LIMIT ? OFFSET ?`)
      .all(snapshotId, ...params, limit, offset) as unknown as PackageRow[];
    return { items: rows.map(toPackage), total };
  }

  function getPackageCandidates(snapshotId: number, name: string): CatalogPackage[] {
    const rows = db
      .prepare(`SELECT * FROM catalog_packages WHERE snapshot_id = ? AND name = ? ORDER BY ${SOURCE_ORDER}`)
      .all(snapshotId, name) as unknown as PackageRow[];
    return rows.map(toPackage);
  }

  function getPackage(snapshotId: number, name: string): CatalogPackage | null {
    return getPackageCandidates(snapshotId, name)[0] ?? null;
  }

  function sourceCounts(snapshotId: number): Record<PackageSource, number> {
    const rows = db
      .prepare("SELECT source, COUNT(*) AS count FROM catalog_packages WHERE snapshot_id = ? GROUP BY source")
      .all(snapshotId) as Array<{ source: PackageSource; count: number }>;
    const counts: Record<PackageSource, number> = { official: 0, dllkids: 0, supplement: 0 };
    for (const row of rows) counts[row.source] = Number(row.count);
    return counts;
  }

  function listCategories(snapshotId: number): string[] {
    const rows = db
      .prepare("SELECT DISTINCT category FROM catalog_packages WHERE snapshot_id = ? ORDER BY category")
      .all(snapshotId) as Array<{ category: string }>;
    return rows.map((row) => row.category);
  }

  return {
    findSnapshot,
    getActiveSnapshot,
    latestForBaseVersion,
    activateSnapshot,
    saveSnapshot,
    listProfiles,
    searchPackages,
    getPackage,
    getPackageCandidates,
    sourceCounts,
    listCategories,
  };
}

