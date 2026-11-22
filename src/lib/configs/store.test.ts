import { afterEach, describe, expect, it } from "vitest";
import { migrate, openDatabase } from "@/lib/db";
import { createSavedConfigStore, describeConfig, isConfigDocument } from "./store";

const dbs: ReturnType<typeof openDatabase>[] = [];

function store() {
  const db = openDatabase(":memory:");
  migrate(db);
  dbs.push(db);
  return createSavedConfigStore(db);
}

afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

function document(hostname = "nas"): ReturnType<typeof buildDocument> {
  return buildDocument(hostname);
}

function buildDocument(hostname: string) {
  return {
    format: "combinewrt-build" as const,
    schemaVersion: 1 as const,
    savedAt: "2026-11-22T00:00:00.000Z",
    config: {
      targetId: "x86/64",
      profileId: "generic",
      release: "25.12.2",
      variant: { boot: "efi", filesystem: "ext4", artifact: "combined" },
      hostname,
      packages: ["luci-app-store", "taskd"],
    },
  };
}

describe("saved configs", () => {
  it("creates, lists, updates and removes a config", () => {
    const configs = store();
    const created = configs.create({ name: "NAS 常用", document: document() });
    expect(created.name).toBe("NAS 常用");
    expect(configs.count()).toBe(1);
    expect(configs.list()[0]?.id).toBe(created.id);

    const renamed = configs.update(created.id, { name: "NAS 生产" });
    expect(renamed?.name).toBe("NAS 生产");
    expect(configs.get(created.id)?.name).toBe("NAS 生产");

    expect(configs.remove(created.id)).toBe(true);
    expect(configs.get(created.id)).toBeNull();
    expect(configs.count()).toBe(0);
  });

  it("keeps the document intact across a round trip", () => {
    const configs = store();
    const created = configs.create({ name: "x", document: document("router-1") });
    const loaded = configs.get(created.id);
    expect(loaded?.document.config.hostname).toBe("router-1");
    expect(isConfigDocument(loaded?.document)).toBe(true);
  });

  it("describes a config for the list card", () => {
    const summary = describeConfig(document());
    expect(summary).toMatchObject({
      target: "x86/64",
      profile: "generic",
      release: "25.12.2",
      variant: "efi / ext4 / combined",
      hostname: "nas",
      packages: 2,
    });
  });

  it("rejects documents that are not the portable build config", () => {
    expect(isConfigDocument(null)).toBe(false);
    expect(isConfigDocument({ format: "other" })).toBe(false);
    expect(isConfigDocument({ format: "combinewrt-build", schemaVersion: 1, config: [] })).toBe(false);
    expect(isConfigDocument(document())).toBe(true);
  });
});
