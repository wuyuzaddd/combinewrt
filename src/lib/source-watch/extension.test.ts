import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrate, openDatabase } from "../db";
import type { SourceRegistry, SourceRegistryEntry } from "../sources/types";
import { readCachedIndex } from "./cache";
import { checkExtensionRefs, extensionWatchEntries, runExtensionWatchIfDue } from "./extension";
import { sha256Hex } from "./observe";
import { readSourcePin, readSourceWatchState } from "./store";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function cacheDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "combinewrt-extwatch-"));
  dirs.push(dir);
  return dir;
}

function entry(name: string, repo: string, ref: string): SourceRegistryEntry {
  return { name, source: "extension", strategy: "rebuild", repo, ref, subdir: "." } as SourceRegistryEntry;
}

function registry(entries: SourceRegistryEntry[]): SourceRegistry {
  return { list: () => entries, lookup: () => null };
}

function githubFetch(heads: Record<string, string | number>) {
  return (async (input: string | URL) => {
    const url = String(input);
    const repo = url.replace("https://api.github.com/repos/", "").replace("/commits?per_page=1", "");
    const value = heads[repo];
    if (typeof value === "number") {
      return new Response("rate limited", { status: value });
    }
    return new Response(JSON.stringify([{ sha: value }]));
  }) as unknown as typeof fetch;
}

const CLOCK = new Date("2026-11-16T00:00:00.000Z");

describe("extension registry watch", () => {
  it("lists the extension entries of the checked-in registry shape", () => {
    const entries = extensionWatchEntries(
      registry([entry("luci-theme-argon", "jerrykuku/luci-theme-argon", "a".repeat(40)), { ...entry("official", "x", "y"), source: "official" } as SourceRegistryEntry]),
    );
    expect(entries).toEqual([
      { name: "luci-theme-argon", repo: "jerrykuku/luci-theme-argon", ref: "a".repeat(40), subdir: "." },
    ]);
  });

  it("records one candidate rebuild when a registry ref moves, without adopting it", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const moved = "b".repeat(40);
    const result = await checkExtensionRefs({
      db,
      cacheDir: cacheDir(),
      entries: [
        { name: "luci-theme-argon", repo: "jerrykuku/luci-theme-argon", ref: "a".repeat(40), subdir: "." },
        { name: "luci-app-openclash", repo: "vernesong/OpenClash", ref: moved, subdir: "luci-app-openclash" },
      ],
      fetchImpl: githubFetch({ "jerrykuku/luci-theme-argon": moved, "vernesong/OpenClash": moved }),
      now: () => CLOCK,
    });

    expect(result.error).toBeNull();
    expect(result.changed).toEqual(["luci-theme-argon"]);
    const candidate = readSourcePin(db, "extension", "candidate");
    expect(candidate).toMatchObject({ source: "extension", status: "candidate", observedAt: CLOCK.toISOString() });
    expect(candidate?.metadata.changed).toEqual(["luci-theme-argon"]);
    // No adoption: the active row stays empty and the candidate bytes are cached.
    expect(readSourcePin(db, "extension", "active")).toBeNull();
    if (!candidate?.cachePath) throw new Error("extension candidate cache missing");
    const bytes = (await readCachedIndex(candidate.cachePath)) ?? Buffer.alloc(0);
    expect(sha256Hex(bytes)).toBe(candidate.value);
    expect(JSON.parse(bytes.toString("utf8"))).toEqual({
      "luci-app-openclash": moved,
      "luci-theme-argon": moved,
    });
    db.close();
  });

  it("keeps the interval gate and does not create a candidate when nothing moved", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const entries = [{ name: "luci-theme-argon", repo: "jerrykuku/luci-theme-argon", ref: "a".repeat(40), subdir: "." }];
    const first = await runExtensionWatchIfDue({
      db,
      cacheDir: cacheDir(),
      entries,
      intervalMs: 6 * 60 * 60 * 1000,
      fetchImpl: githubFetch({ "jerrykuku/luci-theme-argon": "a".repeat(40) }),
      now: () => CLOCK,
    });
    expect(first.ran).toBe(true);
    expect(first.result?.changed).toEqual([]);
    expect(readSourcePin(db, "extension", "candidate")).toBeNull();
    expect(readSourceWatchState(db, "extension")?.lastCheckAt).toBe(CLOCK.toISOString());

    const second = await runExtensionWatchIfDue({
      db,
      cacheDir: cacheDir(),
      entries,
      intervalMs: 6 * 60 * 60 * 1000,
      fetchImpl: githubFetch({ "jerrykuku/luci-theme-argon": "c".repeat(40) }),
      now: () => new Date(CLOCK.getTime() + 60 * 60 * 1000),
    });
    expect(second.ran).toBe(false);
    db.close();
  });

  it("records the upstream failure instead of a candidate", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const result = await checkExtensionRefs({
      db,
      cacheDir: cacheDir(),
      entries: [{ name: "luci-theme-argon", repo: "jerrykuku/luci-theme-argon", ref: "a".repeat(40), subdir: "." }],
      fetchImpl: githubFetch({ "jerrykuku/luci-theme-argon": 503 }),
      now: () => CLOCK,
    });

    expect(result.candidatePin).toBeNull();
    expect(result.error).toMatch(/503/);
    expect(readSourcePin(db, "extension", "candidate")).toBeNull();
    expect(readSourceWatchState(db, "extension")?.lastError).toMatch(/503/);
    db.close();
  });
});
