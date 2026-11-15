import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrate, openDatabase } from "../db";
import { pruneArtifactCache, pruneArtifactCacheBySize, readRetentionSummary, recordRetention } from "./retention";

const dirs: string[] = [];
const dbs: DatabaseSync[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  for (const db of dbs.splice(0)) db.close();
});

function cacheDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "combinewrt-retention-"));
  dirs.push(dir);
  return dir;
}

function touch(path: string, content: string, mtime: Date): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
  utimesSync(path, mtime, mtime);
}

describe("pruneArtifactCache (age)", () => {
  it("removes expired artifacts from build directories and the legacy layout", () => {
    const dir = cacheDir();
    const past = new Date("2026-10-01T00:00:00Z");
    const oldNested = join(dir, "11111111-1111-4111-8111-111111111111", "combined.img.gz");
    const freshNested = join(dir, "22222222-2222-4222-8222-222222222222", "combined.img.gz");
    const legacy = join(dir, "33333333-3333-4333-8333-333333333333.zip");
    const freshLegacy = join(dir, "44444444-4444-4444-8444-444444444444.zip");
    touch(oldNested, "old", past);
    touch(freshNested, "fresh", new Date("2026-11-10T00:00:00Z"));
    touch(legacy, "old-legacy", past);
    touch(freshLegacy, "fresh-legacy", new Date("2026-11-10T00:00:00Z"));
    const note = join(dir, "keep.txt");
    writeFileSync(note, "note");
    utimesSync(note, past, past);

    const result = pruneArtifactCache(dir, 7, new Date("2026-11-11T00:00:00Z"));

    expect(result.removed).toBe(2);
    expect(result.removedBytes).toBe("old".length + "old-legacy".length);
    expect(result.failed).toEqual([]);
    expect(existsSync(oldNested)).toBe(false);
    expect(existsSync(freshNested)).toBe(true);
    expect(existsSync(legacy)).toBe(false);
    expect(existsSync(freshLegacy)).toBe(true);
    expect(existsSync(note)).toBe(true);
  });

  it("does nothing when retention is disabled", () => {
    expect(pruneArtifactCache("/nonexistent", 0)).toEqual({ removed: 0, removedBytes: 0, failed: [] });
  });
});

describe("pruneArtifactCacheBySize", () => {
  it("removes the oldest artifacts until the cache fits the budget", () => {
    const dir = cacheDir();
    const oldest = join(dir, "b1", "a.img");
    const middle = join(dir, "b2", "b.img");
    const newest = join(dir, "b3", "c.img");
    touch(oldest, "1111", new Date("2026-11-01T00:00:00Z"));
    touch(middle, "2222", new Date("2026-11-02T00:00:00Z"));
    touch(newest, "3333", new Date("2026-11-03T00:00:00Z"));

    const result = pruneArtifactCacheBySize(dir, 8);

    expect(result.removed).toBe(1);
    expect(result.removedBytes).toBe(4);
    expect(result.remainingBytes).toBe(8);
    expect(existsSync(oldest)).toBe(false);
    expect(existsSync(middle)).toBe(true);
    expect(existsSync(newest)).toBe(true);
  });

  it("treats a zero budget as unlimited", () => {
    const dir = cacheDir();
    const file = join(dir, "b1", "a.img");
    touch(file, "1111", new Date("2026-11-01T00:00:00Z"));
    expect(pruneArtifactCacheBySize(dir, 0).removed).toBe(0);
    expect(existsSync(file)).toBe(true);
  });
});

describe("retention summary", () => {
  it("round-trips sizes and failures through app_meta", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    dbs.push(db);
    recordRetention(db, {
      at: "2026-11-15T00:00:00.000Z",
      removed: 2,
      removedBytes: 2048,
      remainingBytes: 1024,
      entries: 1,
      failed: ["b1/a.img: EACCES"],
    });
    const summary = readRetentionSummary(db);
    expect(summary?.removedBytes).toBe(2048);
    expect(summary?.remainingBytes).toBe(1024);
    expect(summary?.entries).toBe(1);
    expect(summary?.failed).toEqual(["b1/a.img: EACCES"]);
  });
});
