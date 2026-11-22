import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

/** A config document the site accepts: the portable `combinewrt-build` JSON. */
export interface ConfigDocument {
  format: "combinewrt-build";
  schemaVersion: 1;
  savedAt: string;
  config: Record<string, unknown>;
}

export interface SavedConfigRow {
  id: string;
  name: string;
  sourceBuildId: string | null;
  createdAt: string;
  updatedAt: string;
  document: ConfigDocument;
}

interface Row {
  id: string;
  name: string;
  config_json: string;
  source_build_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SavedConfigStore {
  list(limit?: number): SavedConfigRow[];
  count(): number;
  get(id: string): SavedConfigRow | null;
  create(input: { name: string; document: ConfigDocument; sourceBuildId?: string | null }): SavedConfigRow;
  update(id: string, input: { name?: string; document?: ConfigDocument }): SavedConfigRow | null;
  remove(id: string): boolean;
}

/** The exact shape `/api/configs` stores and `/build?config=` replays. */
export function isConfigDocument(value: unknown): value is ConfigDocument {
  if (typeof value !== "object" || value === null) return false;
  const document = value as Record<string, unknown>;
  return (
    document.format === "combinewrt-build" &&
    document.schemaVersion === 1 &&
    typeof document.config === "object" &&
    document.config !== null &&
    !Array.isArray(document.config)
  );
}

function toRow(row: Row): SavedConfigRow {
  return {
    id: row.id,
    name: row.name,
    sourceBuildId: row.source_build_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    document: JSON.parse(row.config_json) as ConfigDocument,
  };
}

export function createSavedConfigStore(db: DatabaseSync): SavedConfigStore {
  return {
    list(limit = 100) {
      return (db.prepare("SELECT * FROM saved_configs ORDER BY updated_at DESC LIMIT ?").all(limit) as unknown as Row[]).map(
        toRow,
      );
    },
    count() {
      const row = db.prepare("SELECT COUNT(*) AS total FROM saved_configs").get() as { total: number };
      return Number(row.total);
    },
    get(id) {
      const row = db.prepare("SELECT * FROM saved_configs WHERE id = ?").get(id) as Row | undefined;
      return row ? toRow(row) : null;
    },
    create({ name, document, sourceBuildId = null }) {
      const id = randomUUID();
      const timestamp = new Date().toISOString();
      db.prepare(
        "INSERT INTO saved_configs (id, name, config_json, source_build_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(id, name, JSON.stringify(document), sourceBuildId, timestamp, timestamp);
      return { id, name, sourceBuildId, createdAt: timestamp, updatedAt: timestamp, document };
    },
    update(id, { name, document }) {
      const current = this.get(id);
      if (!current) return null;
      const timestamp = new Date().toISOString();
      db.prepare("UPDATE saved_configs SET name = ?, config_json = ?, updated_at = ? WHERE id = ?").run(
        name ?? current.name,
        JSON.stringify(document ?? current.document),
        timestamp,
        id,
      );
      return { ...current, name: name ?? current.name, document: document ?? current.document, updatedAt: timestamp };
    },
    remove(id) {
      const result = db.prepare("DELETE FROM saved_configs WHERE id = ?").run(id);
      return Number(result.changes) > 0;
    },
  };
}

/** Short list-card summary; the full document is fetched when applying it. */
export function describeConfig(document: ConfigDocument): {
  target: string;
  profile: string;
  release: string;
  variant: string;
  hostname: string;
  packages: number;
} {
  const config = document.config;
  const variant = (config.variant ?? {}) as Record<string, unknown>;
  const packages = Array.isArray(config.packages) ? config.packages.length : 0;
  const text = (value: unknown): string => (typeof value === "string" ? value : "");
  return {
    target: text(config.targetId),
    profile: text(config.profileId),
    release: text(config.release),
    variant: [variant.boot, variant.filesystem, variant.artifact].filter((item) => typeof item === "string").join(" / "),
    hostname: text(config.hostname),
    packages,
  };
}
