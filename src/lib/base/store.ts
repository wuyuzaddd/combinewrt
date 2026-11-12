import type { DatabaseSync } from "node:sqlite";
import type { BaseCheckState, BaseVersion, SmokeState } from "./types";

const ACTIVE_KEY = "base.active";
const PREVIOUS_KEY = "base.previous";
const CHECK_KEY = "base.check.last";
const SMOKE_KEY = "base.smoke";

interface BaseVersionRow {
  version: string;
  release_date: string | null;
  image_builder_url: string;
  image_builder_sha256: string;
  created_at: string;
}

function toBaseVersion(row: BaseVersionRow): BaseVersion {
  return {
    version: row.version,
    releaseDate: row.release_date,
    imageBuilderUrl: row.image_builder_url,
    imageBuilderSha256: row.image_builder_sha256,
    createdAt: row.created_at,
  };
}

function readMeta(db: DatabaseSync, key: string): string | null {
  const row = db.prepare("SELECT value FROM app_meta WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function writeMeta(db: DatabaseSync, key: string, value: string): void {
  db.prepare(
    `INSERT INTO app_meta (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export interface BaseVersionStore {
  get(version: string): BaseVersion | null;
  list(): BaseVersion[];
  active(): BaseVersion | null;
  previous(): BaseVersion | null;
  setActive(version: string): void;
  setPrevious(version: string | null): void;
  upsert(input: Omit<BaseVersion, "createdAt">): BaseVersion;
  check(): BaseCheckState | null;
  setCheck(state: BaseCheckState): void;
  smoke(): SmokeState | null;
  setSmoke(state: SmokeState | null): void;
  latestSnapshotId(baseVersion: string): number | null;
  activateLatestSnapshot(baseVersion: string): number | null;
  activateSnapshot(snapshotId: number): boolean;
}

export function createBaseVersionStore(db: DatabaseSync): BaseVersionStore {
  function get(version: string): BaseVersion | null {
    const row = db.prepare("SELECT * FROM base_versions WHERE version = ?").get(version) as
      | BaseVersionRow
      | undefined;
    return row ? toBaseVersion(row) : null;
  }

  function active(): BaseVersion | null {
    const version = readMeta(db, ACTIVE_KEY);
    return version ? get(version) : null;
  }

  function previous(): BaseVersion | null {
    const version = readMeta(db, PREVIOUS_KEY);
    return version ? get(version) : null;
  }

  function setActive(version: string): void {
    if (!get(version)) throw new Error(`base version ${version} does not exist`);
    writeMeta(db, ACTIVE_KEY, version);
  }

  function setPrevious(version: string | null): void {
    if (version === null) {
      db.prepare("DELETE FROM app_meta WHERE key = ?").run(PREVIOUS_KEY);
      return;
    }
    if (!get(version)) throw new Error(`base version ${version} does not exist`);
    writeMeta(db, PREVIOUS_KEY, version);
  }

  function upsert(input: Omit<BaseVersion, "createdAt">): BaseVersion {
    db.prepare(
      `INSERT INTO base_versions (version, release_date, image_builder_url, image_builder_sha256)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (version) DO UPDATE SET
         release_date = excluded.release_date,
         image_builder_url = excluded.image_builder_url,
         image_builder_sha256 = excluded.image_builder_sha256`,
    ).run(input.version, input.releaseDate, input.imageBuilderUrl, input.imageBuilderSha256);
    const saved = get(input.version);
    if (!saved) throw new Error(`base version ${input.version} was not persisted`);
    return saved;
  }

  function latestSnapshotId(baseVersion: string): number | null {
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
    writeMeta(db, "catalog.active_snapshot", String(snapshotId));
    return true;
  }

  return {
    get,
    list() {
      const rows = db.prepare("SELECT * FROM base_versions ORDER BY created_at ASC, version ASC").all() as unknown as BaseVersionRow[];
      return rows.map(toBaseVersion);
    },
    active,
    previous,
    setActive,
    setPrevious,
    upsert,
    check() {
      return parseJson<BaseCheckState>(readMeta(db, CHECK_KEY));
    },
    setCheck(state) {
      writeMeta(db, CHECK_KEY, JSON.stringify(state));
    },
    smoke() {
      return parseJson<SmokeState>(readMeta(db, SMOKE_KEY));
    },
    setSmoke(state) {
      if (state === null) {
        db.prepare("DELETE FROM app_meta WHERE key = ?").run(SMOKE_KEY);
      } else {
        writeMeta(db, SMOKE_KEY, JSON.stringify(state));
      }
    },
    latestSnapshotId,
    activateLatestSnapshot(baseVersion) {
      const id = latestSnapshotId(baseVersion);
      if (id === null) return null;
      return activateSnapshot(id) ? id : null;
    },
    activateSnapshot,
  };
}
