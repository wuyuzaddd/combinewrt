import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrate, openDatabase } from "../db";
import { recordObservedCandidate } from "./candidates";
import { readCachedIndex } from "./cache";
import { sha256Hex } from "./observe";
import { readSourcePin, readSourceWatchState } from "./store";
import type { RepoRefObservation } from "./types";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "combinewrt-candidate-"));
  dirs.push(dir);
  return dir;
}

describe("recordObservedCandidate", () => {
  it("records a candidate pin and its cached bytes for a repository ref", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const cacheDir = tempDir();
    const bytes = Buffer.from("supplement index");
    const commit = "c".repeat(40);

    const result = await recordObservedCandidate({
      db,
      cacheDir,
      observation: {
        source: "supplement",
        ref: "https://github.com/example/feed.git",
        observedAt: "2026-11-15T00:00:00.000Z",
        pin: commit,
        bytes,
        parsed: { packages: 3 },
        error: null,
      } satisfies RepoRefObservation<{ packages: number }>,
      metadata: { packageCount: 3 },
    });

    expect(result.error).toBeNull();
    expect(result.record).toMatchObject({
      source: "supplement",
      status: "candidate",
      value: commit,
      observedAt: "2026-11-15T00:00:00.000Z",
      cacheSha256: sha256Hex(bytes),
    });
    if (!result.record?.cachePath) throw new Error("candidate cache path missing");
    expect(sha256Hex((await readCachedIndex(result.record.cachePath)) ?? Buffer.alloc(0))).toBe(
      sha256Hex(bytes),
    );
    expect(readSourceWatchState(db, "supplement")).toMatchObject({
      lastCheckAt: "2026-11-15T00:00:00.000Z",
      lastSuccessAt: "2026-11-15T00:00:00.000Z",
      lastError: null,
    });
  });

  it("keeps the last pin and records the error when observation failed", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const cacheDir = tempDir();

    const result = await recordObservedCandidate({
      db,
      cacheDir,
      observation: {
        source: "extension",
        ref: "https://github.com/example/extension.git",
        observedAt: "2026-11-15T01:00:00.000Z",
        pin: null,
        bytes: null,
        parsed: null,
        error: "upstream offline",
      },
    });

    expect(result.record).toBeNull();
    expect(result.error).toBe("upstream offline");
    expect(readSourcePin(db, "extension", "candidate")).toBeNull();
    expect(readSourceWatchState(db, "extension")).toMatchObject({
      lastError: "upstream offline",
      lastSuccessAt: null,
    });
  });
});
