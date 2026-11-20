import { describe, expect, it } from "vitest";
import { migrate, openDatabase } from "../db";
import { upsertSourcePin } from "../source-watch/store";
import { activeDllkidsPin, activeSourceConfig, resolveActiveDllkidsPin } from "./refresh-active";

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
