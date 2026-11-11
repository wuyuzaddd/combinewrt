import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pruneArtifactCache } from "./retention";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("pruneArtifactCache", () => {
  it("removes only expired zip/tmp files and keeps the rest", () => {
    const dir = mkdtempSync(join(tmpdir(), "combinewrt-retention-"));
    dirs.push(dir);
    const old = join(dir, "11111111-1111-4111-8111-111111111111.zip");
    const fresh = join(dir, "22222222-2222-4222-8222-222222222222.zip");
    const note = join(dir, "keep.txt");
    writeFileSync(old, "old");
    writeFileSync(fresh, "fresh");
    writeFileSync(note, "note");
    const past = new Date("2026-10-01T00:00:00Z");
    utimesSync(old, past, past);

    const foreign = join(dir, "not-a-build.zip");
    writeFileSync(foreign, "foreign");
    utimesSync(foreign, past, past);

    const result = pruneArtifactCache(dir, 7, new Date("2026-11-11T00:00:00Z"));
    expect(result.removed).toBe(1);
    expect(result.failed).toEqual([]);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
    expect(existsSync(note)).toBe(true);
    expect(existsSync(foreign)).toBe(true);
  });

  it("does nothing when retention is disabled", () => {
    expect(pruneArtifactCache("/nonexistent", 0)).toEqual({ removed: 0, failed: [] });
  });
});
