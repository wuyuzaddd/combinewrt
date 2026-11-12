import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrate, openDatabase } from "./db";

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
});
