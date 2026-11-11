import { describe, expect, it } from "vitest";
import { migrate, openDatabase } from "../db";
import { createCatalogStore } from "./store";
import type { CatalogPackage, SnapshotInput } from "./types";

function pkg(overrides: Partial<CatalogPackage>): CatalogPackage {
  return {
    name: "demo",
    version: "1.0",
    arch: "x86_64",
    description: "demo package",
    license: "MIT",
    origin: "feeds/base/utils/demo",
    category: "utils",
    installedSize: 2048,
    depends: ["libc"],
    feed: "base",
    proprietary: false,
    ...overrides,
  };
}

function input(overrides: Partial<SnapshotInput> = {}): SnapshotInput {
  return {
    baseVersion: "25.12.2",
    feedCommit: "r38135-test",
    sourceNote: "fixture",
    profiles: [
      { id: "generic", title: "Generic x86/64", formats: ["ext4-efi", "squashfs-efi"], imageCount: 25 },
      { id: "tiny", title: "Tiny", formats: ["rootfs-tar"], imageCount: 1 },
    ],
    packages: [
      pkg({ name: "wireguard-tools", description: "wireguard userspace tools" }),
      pkg({
        name: "luci-app-demo",
        description: "demo web interface",
        category: "applications",
        origin: "feeds/luci/applications/luci-app-demo",
      }),
      pkg({ name: "vendor-blob", description: "closed source blob", license: null, proprietary: true }),
    ],
    ...overrides,
  };
}

function freshStore() {
  const db = openDatabase(":memory:");
  migrate(db);
  return { db, store: createCatalogStore(db) };
}

describe("catalog store", () => {
  it("persists an immutable snapshot and points the active pointer at it", () => {
    const { store } = freshStore();
    const saved = store.saveSnapshot(input());

    expect(saved.profileCount).toBe(2);
    expect(saved.packageCount).toBe(3);
    expect(store.getActiveSnapshot()?.id).toBe(saved.id);
    expect(store.listProfiles(saved.id)).toHaveLength(2);
    expect(store.listCategories(saved.id)).toEqual(["applications", "utils"]);
  });

  it("returns the existing snapshot for the same base version and feed commit", () => {
    const { store } = freshStore();
    const first = store.saveSnapshot(input());
    const second = store.saveSnapshot(input({ packages: [pkg({ name: "other" })] }));

    expect(second.id).toBe(first.id);
    expect(store.searchPackages(first.id, {}).total).toBe(3);
  });

  it("searches by name or description and filters by category", () => {
    const { store } = freshStore();
    const snapshot = store.saveSnapshot(input());

    expect(store.searchPackages(snapshot.id, { query: "wireguard" }).items[0].name).toBe("wireguard-tools");
    expect(store.searchPackages(snapshot.id, { query: "web interface" }).total).toBe(1);
    expect(store.searchPackages(snapshot.id, { category: "applications" }).items[0].name).toBe("luci-app-demo");
    expect(store.searchPackages(snapshot.id, { query: "%" }).total).toBe(0);
  });

  it("paginates results", () => {
    const { store } = freshStore();
    const snapshot = store.saveSnapshot(
      input({
        packages: Array.from({ length: 7 }, (_, index) => pkg({ name: `pkg-${index}` })),
      }),
    );
    const page = store.searchPackages(snapshot.id, { limit: 3, offset: 3 });
    expect(page.total).toBe(7);
    expect(page.items.map((item) => item.name)).toEqual(["pkg-3", "pkg-4", "pkg-5"]);
  });

  it("loads a package detail and moves the active pointer on a new snapshot", () => {
    const { store } = freshStore();
    const first = store.saveSnapshot(input());
    const detail = store.getPackage(first.id, "vendor-blob");
    expect(detail).toMatchObject({ license: null, proprietary: true, depends: ["libc"] });

    const second = store.saveSnapshot(input({ feedCommit: "r38135-next" }));
    expect(second.id).not.toBe(first.id);
    expect(store.getActiveSnapshot()?.id).toBe(second.id);
    expect(store.findSnapshot("25.12.2", "r38135-test")?.id).toBe(first.id);
  });
});
