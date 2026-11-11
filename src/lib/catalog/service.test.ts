import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { migrate, openDatabase } from "../db";
import { refreshCatalog, type CatalogSource } from "./service";
import { createCatalogStore } from "./store";

const profilesJson = JSON.parse(
  readFileSync(new URL("./fixtures/profiles-x86-64.json", import.meta.url), "utf8"),
) as unknown;
const dump = readFileSync(new URL("./fixtures/base-excerpt.dump", import.meta.url), "utf8");

function source(overrides: Partial<CatalogSource> = {}): CatalogSource & { dumpCalls: number } {
  const state = {
    dumpCalls: 0,
    baseVersion: "25.12.2",
    loadMeta: async () => ({ profilesJson, feedCommit: "r38135-test", sourceNote: "fixture" }),
    loadDumps: async () => {
      state.dumpCalls += 1;
      return [{ feed: "base", dump }];
    },
    ...overrides,
  };
  return state as CatalogSource & { dumpCalls: number };
}

function freshDb() {
  const db = openDatabase(":memory:");
  migrate(db);
  return db;
}

describe("refreshCatalog", () => {
  it("creates an active snapshot from profiles and feed dumps", async () => {
    const db = freshDb();
    const result = await refreshCatalog({ source: source(), db });

    expect(result.created).toBe(true);
    expect(result.snapshot.packageCount).toBe(5);
    expect(createCatalogStore(db).getActiveSnapshot()?.id).toBe(result.snapshot.id);
  });

  it("does not re-download dumps for an existing key", async () => {
    const db = freshDb();
    const catalogSource = source();
    await refreshCatalog({ source: catalogSource, db });
    const second = await refreshCatalog({ source: catalogSource, db });

    expect(second.created).toBe(false);
    expect(catalogSource.dumpCalls).toBe(1);
  });

  it("keeps the old active snapshot when parsing fails", async () => {
    const db = freshDb();
    const first = await refreshCatalog({ source: source(), db });

    const broken = source({
      loadMeta: async () => ({ profilesJson, feedCommit: "r38135-broken", sourceNote: "fixture" }),
      loadDumps: async () => [{ feed: "base", dump: "packages: # 0 items\n" }],
    });

    await expect(refreshCatalog({ source: broken, db })).rejects.toThrow(/no packages/);
    expect(createCatalogStore(db).getActiveSnapshot()?.id).toBe(first.snapshot.id);
  });

  it("rejects non-x86_64 profiles before writing anything", async () => {
    const db = freshDb();
    const wrongArch = source({
      loadMeta: async () => ({
        profilesJson: { arch_packages: "aarch64_generic", profiles: {} },
        feedCommit: "r38135-arm",
        sourceNote: "fixture",
      }),
    });

    await expect(refreshCatalog({ source: wrongArch, db })).rejects.toThrow(/x86_64/);
    expect(createCatalogStore(db).getActiveSnapshot()).toBeNull();
  });
});
