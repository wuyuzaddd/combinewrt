import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
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
    const old = join(dir, "old.zip");
    const fresh = join(dir, "fresh.zip");
    const note = join(dir, "keep.txt");
    writeFileSync(old, "old");
    writeFileSync(fresh, "fresh");
    writeFileSync(note, "note");
    const past = new Date("2026-10-01T00:00:00Z");
    utimesSync(old, past, past);

    const result = pruneArtifactCache(dir, 7, new Date("2026-11-11T00:00:00Z"));
    expect(result.removed).toBe(1);
    expect(result.failed).toEqual([]);
  });

  it("does nothing when retention is disabled", () => {
    expect(pruneArtifactCache("/nonexistent", 0)).toEqual({ removed: 0, failed: [] });
  });
});
