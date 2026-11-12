import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate, openDatabase } from "../db";
import { createBaseVersionStore } from "./store";

const dirs: string[] = [];

function database() {
  const dir = mkdtempSync(join(tmpdir(), "combinewrt-base-"));
  dirs.push(dir);
  const db = openDatabase(join(dir, "test.db"));
  migrate(db);
  return db;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("base version store", () => {
  it("seeds the pinned 25.12.2 baseline", () => {
    const db = database();
    const store = createBaseVersionStore(db);
    expect(store.active()).toMatchObject({
      version: "25.12.2",
      releaseDate: "2026-09-08",
      imageBuilderSha256: "b9b290f5ef60a22bccd5bdca9c1e7523b8fc84e60462afbf550e20db94acf2c6",
    });
    db.close();
  });

  it("tracks active, previous, check and smoke state", () => {
    const db = database();
    const store = createBaseVersionStore(db);
    store.upsert({
      version: "25.12.3",
      releaseDate: "2026-10-01",
      imageBuilderUrl: "https://example.invalid/ib.tar.zst",
      imageBuilderSha256: "a".repeat(64),
    });
    store.setPrevious("25.12.2");
    store.setActive("25.12.3");
    expect(store.active()?.version).toBe("25.12.3");
    expect(store.previous()?.version).toBe("25.12.2");

    store.setCheck({ checkedAt: "2026-10-02T00:00:00.000Z", latest: null, error: null });
    expect(store.check()?.checkedAt).toBe("2026-10-02T00:00:00.000Z");

    store.setSmoke({
      phase: "building",
      buildId: "b1",
      snapshotId: 7,
      error: null,
      startedAt: "2026-10-02T00:00:00.000Z",
      updatedAt: "2026-10-02T00:00:00.000Z",
    });
    expect(store.smoke()?.phase).toBe("building");
    store.setSmoke(null);
    expect(store.smoke()).toBeNull();
    db.close();
  });

  it("activates the newest snapshot for a baseline", () => {
    const db = database();
    const store = createBaseVersionStore(db);
    db.prepare(
      `INSERT INTO catalog_snapshots (base_version, feed_commit, source_note, source_pins, profile_count, package_count)
       VALUES ('25.12.2', 'old', 'fixture', '{}', 1, 1)`,
    ).run();
    db.prepare(
      `INSERT INTO catalog_snapshots (base_version, feed_commit, source_note, source_pins, profile_count, package_count)
       VALUES ('25.12.2', 'new', 'fixture', '{}', 1, 1)`,
    ).run();
    expect(store.activateLatestSnapshot("25.12.2")).toBe(2);
    const pointer = db.prepare("SELECT value FROM app_meta WHERE key = 'catalog.active_snapshot'").get() as {
      value: string;
    };
    expect(pointer.value).toBe("2");
    db.close();
  });
});
