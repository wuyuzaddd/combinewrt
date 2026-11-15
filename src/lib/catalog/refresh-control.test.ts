import { describe, expect, it } from "vitest";
import { migrate, openDatabase } from "../db";
import type { SnapshotMeta } from "./types";
import {
  CATALOG_REFRESH_MAX_AGE_MS,
  createCatalogRefreshRunner,
  readCatalogRefreshState,
} from "./refresh-control";

function snapshot(id: number): SnapshotMeta {
  return {
    id,
    baseVersion: "25.12.2",
    feedCommit: `feed-${id}`,
    sourceNote: "fixture",
    sourcePins: { official: {}, dllkids: null, supplement: null, kernel: null },
    createdAt: "2026-11-15T00:00:00.000Z",
    profileCount: 1,
    packageCount: 1,
  };
}

function freshDb() {
  const db = openDatabase(":memory:");
  migrate(db);
  return db;
}

describe("catalog refresh runner", () => {
  it("runs when stale and skips while fresh", async () => {
    const db = freshDb();
    let calls = 0;
    const runner = createCatalogRefreshRunner({
      db,
      refresh: async () => {
        calls += 1;
        return { snapshot: snapshot(calls), created: true };
      },
    });

    const first = await runner.runIfDue();
    const second = await runner.runIfDue();

    expect(first.ran).toBe(true);
    expect(first.result?.snapshot.id).toBe(1);
    expect(second).toEqual({ ran: false, reason: "fresh" });
    expect(calls).toBe(1);
    expect(readCatalogRefreshState(db)).toMatchObject({ snapshotId: 1, lastError: null });
  });

  it("lets a manual run bypass the freshness window", async () => {
    const db = freshDb();
    let calls = 0;
    const runner = createCatalogRefreshRunner({
      db,
      refresh: async () => {
        calls += 1;
        return { snapshot: snapshot(calls), created: false };
      },
    });

    await runner.runIfDue();
    const manual = await runner.run();

    expect(manual.ran).toBe(true);
    expect(calls).toBe(2);
  });

  it("records a failure without replacing the last successful snapshot", async () => {
    const db = freshDb();
    let fail = false;
    const runner = createCatalogRefreshRunner({
      db,
      refresh: async () => {
        if (fail) throw new Error("upstream feed unavailable");
        return { snapshot: snapshot(7), created: true };
      },
    });

    await runner.run();
    fail = true;
    const outcome = await runner.run();

    expect(outcome.error).toBe("upstream feed unavailable");
    expect(readCatalogRefreshState(db)).toMatchObject({
      snapshotId: 7,
      lastError: "upstream feed unavailable",
    });
    expect(readCatalogRefreshState(db).lastSuccessAt).not.toBeNull();
  });

  it("coalesces concurrent runs", async () => {
    const db = freshDb();
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runner = createCatalogRefreshRunner({
      db,
      refresh: async () => {
        calls += 1;
        await gate;
        return { snapshot: snapshot(1), created: true };
      },
    });

    const first = runner.run();
    const second = await runner.run();
    release();
    await first;

    expect(second).toEqual({ ran: false, reason: "in-flight" });
    expect(calls).toBe(1);
  });

  it("re-runs once the last success is older than the window", async () => {
    const db = freshDb();
    let now = new Date("2026-11-15T00:00:00.000Z");
    let calls = 0;
    const runner = createCatalogRefreshRunner({
      db,
      now: () => now,
      refresh: async () => {
        calls += 1;
        return { snapshot: snapshot(calls), created: false };
      },
    });

    await runner.runIfDue();
    now = new Date(now.getTime() + CATALOG_REFRESH_MAX_AGE_MS + 1);
    const second = await runner.runIfDue();

    expect(second.ran).toBe(true);
    expect(calls).toBe(2);
  });
});
