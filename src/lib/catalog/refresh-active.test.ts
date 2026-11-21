import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { migrate, openDatabase } from "../db";
import { upsertSourcePin } from "../source-watch/store";
import {
  activeDllkidsPin,
  activeSourceConfig,
  cachedDllkidsIndex,
  resolveActiveDllkidsPin,
  resolvePlanDllkidsPin,
} from "./refresh-active";

const ENV_SEED = "1".repeat(64);
const ADOPTED = "2".repeat(64);

function configured(dllkidsIndexSha256: string) {
  return {
    apkBin: "apk",
    dllkidsFeedUrl: "https://down.dllkids.xyz/openwrt-feed/25.12/x86_64",
    dllkidsIndexSha256,
    supplementFeedCommit: "",
    supplementKeyFingerprint: "",
    supplementFeedUrl: "",
    supplementKeyUrl: "",
  };
}

describe("active dllkids pin", () => {
  it("uses the config constant as the seed when no pin is stored", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    expect(activeDllkidsPin(db, { dllkidsIndexSha256: ENV_SEED })).toBe(ENV_SEED);
    expect(resolveActiveDllkidsPin(db, { dllkidsIndexSha256: ENV_SEED })).toEqual({
      value: ENV_SEED,
      source: "config-seed",
    });
    db.close();
  });

  it("keeps the resolved snapshot pin for a plan even when the DB has moved on", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    upsertSourcePin(db, { source: "dllkids", status: "active", value: ADOPTED, metadata: { adoptedBy: "auto" } });

    // The snapshot's package entries carry SNAPSHOT_PIN; the plan pin must be
    // that value, not the live DB pin, or the composition check hard-blocks.
    const SNAPSHOT_PIN = "dllkids-index-sha";
    expect(resolvePlanDllkidsPin(db, { dllkidsIndexSha256: ENV_SEED }, SNAPSHOT_PIN)).toEqual({
      value: SNAPSHOT_PIN,
      source: "snapshot",
    });
    // No snapshot pin: fall back to the DB-adopted pin, then the seed.
    expect(resolvePlanDllkidsPin(db, { dllkidsIndexSha256: ENV_SEED }, null)).toEqual({
      value: ADOPTED,
      source: "database",
    });
    db.close();
  });

  it("falls back to the config seed and marks it when neither snapshot nor DB has a pin", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    expect(resolvePlanDllkidsPin(db, { dllkidsIndexSha256: ENV_SEED }, null)).toEqual({
      value: ENV_SEED,
      source: "config-seed",
    });
    db.close();
  });

  it("names the adopted database pin as the authority", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    upsertSourcePin(db, { source: "dllkids", status: "active", value: ADOPTED, metadata: { adoptedBy: "auto" } });

    expect(resolveActiveDllkidsPin(db, { dllkidsIndexSha256: ENV_SEED })).toEqual({
      value: ADOPTED,
      source: "database",
    });
    db.close();
  });

  it("lets a DB-adopted pin win over a stale config/env value", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    upsertSourcePin(db, { source: "dllkids", status: "active", value: ADOPTED, metadata: { adoptedBy: "auto" } });

    // Ticket 10 writes the adopted pin to source_pins; the config value is only
    // a seed. Refresh must not fall back to the stale env value.
    expect(activeDllkidsPin(db, { dllkidsIndexSha256: ENV_SEED })).toBe(ADOPTED);
    expect(activeSourceConfig(db, configured(ENV_SEED)).dllkidsIndexSha256).toBe(ADOPTED);
    db.close();
  });
});

describe("cached dllkids index", () => {
  it("reuses the adopted pin's cached bytes instead of refetching a throttled feed", () => {
    const dir = mkdtempSync(join(tmpdir(), "cw-pin-"));
    try {
      const bytes = Buffer.from("adb-bytes");
      const cachePath = join(dir, "index.adb");
      writeFileSync(cachePath, bytes);
      const db = openDatabase(":memory:");
      migrate(db);
      upsertSourcePin(db, {
        source: "dllkids",
        status: "active",
        value: ADOPTED,
        observedAt: "2026-11-21T00:00:00Z",
        adoptedAt: "2026-11-21T00:00:01Z",
        adoptedBy: "test",
        cachePath,
        cacheSha256: ADOPTED,
        metadata: {},
      } as never);

      expect(Buffer.from(cachedDllkidsIndex(db) ?? [])).toEqual(bytes);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ignores cached bytes whose sha does not match the pin", () => {
    const dir = mkdtempSync(join(tmpdir(), "cw-pin-"));
    try {
      const cachePath = join(dir, "index.adb");
      writeFileSync(cachePath, "stale");
      const db = openDatabase(":memory:");
      migrate(db);
      upsertSourcePin(db, {
        source: "dllkids",
        status: "active",
        value: ADOPTED,
        observedAt: "2026-11-21T00:00:00Z",
        adoptedAt: "2026-11-21T00:00:01Z",
        adoptedBy: "test",
        cachePath,
        cacheSha256: "9".repeat(64),
        metadata: {},
      } as never);
      expect(cachedDllkidsIndex(db)).toBeNull();
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
