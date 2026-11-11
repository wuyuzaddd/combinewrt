import { describe, expect, it } from "vitest";
import { openDatabase, migrate } from "../db";
import { createBuildStore } from "./store";
import type { BuildRecord } from "./types";

function record(id: string, createdAt: string): BuildRecord {
  return {
    id,
    plan: {
      baseVersion: "25.12.2",
      feedCommit: "abc",
      sourceNote: "fixture",
      profileId: "generic",
      profileTitle: "Generic",
      imageType: "ext4-efi",
      packages: ["luci"],
      resolved: [],
      missingDependencies: [],
      conflicts: [],
      files: [],
      artifactName: `img-${id}`,
      imageBuilderCommand: "make image",
      createdAt,
    },
    config: {
      profile: "generic",
      imageType: "ext4-efi",
      hostname: `host-${id}`,
      timezone: "UTC",
      lanIp: "192.168.1.1",
      netmask: "255.255.255.0",
      packages: ["luci"],
    },
    status: "queued",
    runId: null,
    adapter: "fake",
    logTail: "",
    error: null,
    artifactName: `img-${id}`,
    createdAt,
    updatedAt: createdAt,
  };
}

describe("build store", () => {
  it("paginates, counts and round-trips the saved config", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const store = createBuildStore(db);
    store.create(record("a", "2026-11-11T00:00:00Z"));
    store.create(record("b", "2026-11-11T00:01:00Z"));
    store.create(record("c", "2026-11-11T00:02:00Z"));

    expect(store.count()).toBe(3);
    expect(store.list(2, 0).map((item) => item.id)).toEqual(["c", "b"]);
    expect(store.list(2, 2).map((item) => item.id)).toEqual(["a"]);
    expect(store.get("b")?.config?.hostname).toBe("host-b");
    db.close();
  });
});
