import { describe, expect, it } from "vitest";
import { openDatabase, migrate } from "../db";
import { isBuildPlanV2, readBuildPlan } from "../domain/build-plan";
import type { BuildPlanV1, BuildPlanV2 } from "../domain/build-plan";
import { isRedactedPlan } from "./redact";
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
      topLevelPackages: ["luci"],
      downloads: [],
      sourcePins: { official: {}, dllkids: null, supplement: null, kernel: null },
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

  it("reads a plan without schemaVersion as a read-only V1 plan", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const store = createBuildStore(db);
    store.create(record("a", "2026-11-11T00:00:00Z"));

    const saved = store.get("a");
    const readable = readBuildPlan(saved?.plan);
    expect(readable.schemaVersion).toBe(1);
    expect(readable.readOnly).toBe(true);

    const raw = db.prepare("SELECT plan_json FROM builds WHERE id = 'a'").get() as { plan_json: string };
    expect((JSON.parse(raw.plan_json) as { schemaVersion?: number }).schemaVersion).toBeUndefined();
    db.close();
  });

  it("round-trips a V2 plan with its target, kernel line and image variant", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const store = createBuildStore(db);
    const legacy = record("v2", "2026-11-11T00:03:00Z");
    const plan: BuildPlanV2 = {
      ...(legacy.plan as BuildPlanV1),
      schemaVersion: 2,
      channel: "snapshot",
      target: { id: "x86/64", architecture: "x86_64", subtarget: "generic", title: "x86/64" },
      deviceProfile: { targetId: "x86/64", id: "generic", title: "Generic", capabilities: [] },
      kernelLine: { id: "6.18", version: "6.18", engine: "source", sourceRecipeRef: "kernel/6.18" },
      imageVariant: { boot: "legacy", filesystem: "ext4", artifact: "vmdk", overlaySizeMb: 512 },
      basePreset: { id: "base", layer: "file/board" },
      overlays: [{ id: "overlay", layer: "package/kernel" }],
      engine: "source",
      warnings: [],
      kernelConfig: [],
    };
    store.create({ ...legacy, plan });

    const saved = store.get("v2");
    expect(saved && isBuildPlanV2(saved.plan)).toBe(true);
    if (saved && isBuildPlanV2(saved.plan)) {
      expect(saved.plan.channel).toBe("snapshot");
      expect(saved.plan.kernelLine.version).toBe("6.18");
      expect(saved.plan.imageVariant.artifact).toBe("vmdk");
      expect(saved.plan.overlays[0].id).toBe("overlay");
      expect(saved.plan.artifactName).toBe("img-v2");
    }
    db.close();
  });

  it("records creation and status transitions as events", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const store = createBuildStore(db);
    store.create(record("a", "2026-11-11T00:00:00Z"));

    store.update("a", { status: "running" }, undefined, "poll");
    store.update("a", { status: "cancelled" }, undefined, "cancel");
    store.update("a", { logTail: "still here" });

    expect(store.listEvents("a").map((event) => [event.fromStatus, event.toStatus, event.source])).toEqual([
      [null, "queued", "create"],
      ["queued", "running", "poll"],
      ["running", "cancelled", "cancel"],
    ]);
    db.close();
  });

  it("does not write an event when the optimistic update loses the race", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const store = createBuildStore(db);
    store.create(record("a", "2026-11-11T00:00:00Z"));

    store.update("a", { status: "running" }, "2000-01-01T00:00:00.000Z");

    expect(store.get("a")?.status).toBe("queued");
    expect(store.listEvents("a")).toHaveLength(1);
    db.close();
  });

  it("claims the oldest queued build atomically and respects the running cap", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const store = createBuildStore(db);
    store.create(record("a", "2026-11-11T00:00:00Z"));
    store.create(record("b", "2026-11-11T00:01:00Z"));
    store.create(record("c", "2026-11-11T00:02:00Z"));

    const claimed = store.claimNextQueued(2, "2026-11-11T02:00:00.000Z");
    expect(claimed?.id).toBe("a");
    expect(claimed?.status).toBe("running");
    expect(claimed?.dispatchedAt).toBe("2026-11-11T02:00:00.000Z");

    expect(store.claimNextQueued(2, "2026-11-11T02:00:01.000Z")?.id).toBe("b");
    expect(store.claimNextQueued(2, "2026-11-11T02:00:02.000Z")).toBeNull();
    expect(store.countRunning()).toBe(2);
    // A claim is a dispatch attempt: queued -> running is on the timeline.
    expect(store.listEvents("a").at(-1)).toMatchObject({ fromStatus: "queued", toStatus: "running", source: "dispatch" });

    store.update("a", { status: "succeeded" });
    expect(store.claimNextQueued(2, "2026-11-11T02:00:03.000Z")?.id).toBe("c");
    expect(store.countRunning()).toBe(2);
    db.close();
  });

  it("reports the FIFO queue position and forgets it once dispatched", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const store = createBuildStore(db);
    store.create(record("a", "2026-11-11T00:00:00Z"));
    store.create(record("b", "2026-11-11T00:00:00Z"));
    store.create(record("c", "2026-11-11T00:01:00Z"));

    expect(store.queuePosition("a")).toBe(1);
    expect(store.queuePosition("b")).toBe(2);
    expect(store.queuePosition("c")).toBe(3);
    store.update("a", { status: "running" });
    expect(store.queuePosition("a")).toBeNull();
    expect(store.queuePosition("b")).toBe(1);
    db.close();
  });

  it("records the run id and clears the sealed payload in one statement", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const store = createBuildStore(db);
    store.create(record("a", "2026-11-11T00:00:00Z"), "sealed-envelope");
    expect(store.readDispatchPayload("a")).toBe("sealed-envelope");

    const updated = store.recordDispatchRun("a", "run-a", "2026-11-11T00:00:00Z");
    expect(updated.runId).toBe("run-a");
    expect(store.get("a")?.runId).toBe("run-a");
    // Ticket 07: there is no intermediate row where the payload is gone but the
    // run id is not written yet.
    expect(store.readDispatchPayload("a")).toBeNull();

    // A lost optimistic race leaves the row untouched and returns it as-is.
    const raced = store.recordDispatchRun("a", "run-other", "2000-01-01T00:00:00.000Z");
    expect(raced.runId).toBe("run-a");
    expect(store.get("a")?.runId).toBe("run-a");
    db.close();
  });

  it("leaves legacy rows readable when the queue columns are null", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const store = createBuildStore(db);
    store.create(record("old", "2026-11-11T00:00:00Z"));

    const saved = store.get("old");
    expect(saved?.engine).toBeNull();
    expect(saved?.target).toBeNull();
    expect(saved?.dispatchedAt).toBeNull();
    expect(saved?.status).toBe("queued");
    db.close();
  });
});

describe("plan redaction at rest", () => {
  it("never persists generated file contents or typed network secrets", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const store = createBuildStore(db);
    const secret = "hunter2-pppoe";
    const rootHash = "$5$rounds=1000$abcdefgh$0123456789abcdef";
    const build = record("secret", "2026-11-11T00:00:00Z");
    build.plan = {
      ...build.plan,
      files: [{ path: "files/etc/uci-defaults/99-combinewrt", content: `root_password='${rootHash}'`, mode: 0o755 }],
      modes: {
        basePreset: { id: "router-default", layer: "file/board" },
        overlays: [],
        experimental: [],
        network: { wan: { protocol: "pppoe", username: "user@isp", password: secret }, wifi: { ssid: "net", key: "wifi-psk", country: "CN", channel: 36, band: "5g" } },
        secrets: [],
        generatedFiles: [],
      },
    } as never;

    store.create(build);

    const raw = db.prepare("SELECT plan_json FROM builds WHERE id = 'secret'").get() as { plan_json: string };
    // The row is copied into database dumps: no secret may live there.
    expect(raw.plan_json).not.toContain(secret);
    expect(raw.plan_json).not.toContain("wifi-psk");
    expect(raw.plan_json).not.toContain(rootHash);
    expect(raw.plan_json).not.toContain("127.0.0.1");

    const saved = store.get("secret");
    expect(saved?.plan.files.map((file) => file.path)).toEqual(["files/etc/uci-defaults/99-combinewrt"]);
    expect(isRedactedPlan(saved!.plan)).toBe(true);
  });
});
