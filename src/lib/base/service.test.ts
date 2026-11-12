import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate, openDatabase } from "../db";
import { createCatalogStore } from "../catalog/store";
import { RELEASES_ROOT } from "./releases";
import { createBaseVersionService } from "./service";
import { createBaseVersionStore } from "./store";

const SHA = "b9b290f5ef60a22bccd5bdca9c1e7523b8fc84e60462afbf550e20db94acf2c6";
const dirs: string[] = [];

function database() {
  const dir = mkdtempSync(join(tmpdir(), "combinewrt-base-service-"));
  dirs.push(dir);
  const db = openDatabase(join(dir, "test.db"));
  migrate(db);
  return db;
}

function fakeFetch(index = true) {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === RELEASES_ROOT) {
      if (!index) return new Response("nope", { status: 500 });
      return new Response(
        `<tr><td class="n"><a href="25.12.2/">25.12.2</a>/</td><td class="s">-</td><td class="d">Tue Sep  8 21:42:22 2026</td></tr>
         <tr><td class="n"><a href="25.12.3/">25.12.3</a>/</td><td class="s">-</td><td class="d">Thu Oct  1 00:00:00 2026</td></tr>`,
      );
    }
    if (url.includes("/25.12.3/targets/x86/64/sha256sums")) {
      return new Response(`${SHA} *immortalwrt-imagebuilder-25.12.3-x86-64.Linux-x86_64.tar.zst`);
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("base version service", () => {
  it("discovers a newer release without adopting it", async () => {
    const db = database();
    const store = createBaseVersionStore(db);
    const service = createBaseVersionService({
      store,
      fetchImpl: fakeFetch(),
      refresh: vi.fn(),
      submitSmoke: vi.fn(),
    });

    const check = await service.checkForNewRelease();
    expect(check.error).toBeNull();
    expect(check.latest?.version).toBe("25.12.3");
    expect(service.readState().active?.version).toBe("25.12.2");
    expect(service.readState().candidate?.version).toBe("25.12.3");
    db.close();
  });

  it("records check failures without changing the baseline", async () => {
    const db = database();
    const service = createBaseVersionService({
      store: createBaseVersionStore(db),
      fetchImpl: fakeFetch(false),
      refresh: vi.fn(),
      submitSmoke: vi.fn(),
    });
    const check = await service.checkForNewRelease();
    expect(check.error).toContain("HTTP 500");
    expect(service.readState().active?.version).toBe("25.12.2");
    db.close();
  });

  it("bumps, refreshes, submits a smoke build and supports revert", async () => {
    const db = database();
    const store = createBaseVersionStore(db);
    db.prepare(
      `INSERT INTO catalog_snapshots (base_version, feed_commit, source_note, source_pins, profile_count, package_count)
       VALUES ('25.12.2', 'old', 'fixture', '{}', 1, 1)`,
    ).run();
    const refresh = vi.fn(async () => ({ snapshotId: 9 }));
    const submitSmoke = vi.fn(async () => ({ buildId: "build-1" }));
    const service = createBaseVersionService({
      store,
      fetchImpl: fakeFetch(),
      refresh,
      submitSmoke,
      now: () => new Date("2026-10-02T00:00:00.000Z"),
    });

    await service.checkForNewRelease();
    await service.bump("25.12.3");
    await vi.waitFor(() => expect(service.readState().smoke?.buildId).toBe("build-1"));

    expect(refresh).toHaveBeenCalledWith("25.12.3");
    expect(submitSmoke).toHaveBeenCalledWith("25.12.3", 9);
    expect(service.readState().active?.version).toBe("25.12.3");
    expect(service.readState().previous?.version).toBe("25.12.2");
    expect(service.readState().smoke).toMatchObject({ phase: "building", buildId: "build-1", snapshotId: 9 });

    service.noteSmokeBuild("failed", "image build failed");
    expect(service.readState().smoke).toMatchObject({ phase: "failed", error: "image build failed" });

    await service.revert();
    expect(service.readState().active?.version).toBe("25.12.2");
    expect(service.readState().previous?.version).toBe("25.12.3");
    expect(service.readState().smoke).toBeNull();
    const pointer = db.prepare("SELECT value FROM app_meta WHERE key = 'catalog.active_snapshot'").get() as {
      value: string;
    };
    expect(pointer.value).toBe("1");
    db.close();
  });

  it("rolls the baseline back when catalog refresh fails", async () => {
    const db = database();
    const store = createBaseVersionStore(db);
    db.prepare(
      `INSERT INTO catalog_snapshots (base_version, feed_commit, source_note, source_pins, profile_count, package_count)
       VALUES ('25.12.2', 'old', 'fixture', '{}', 1, 1)`,
    ).run();
    const catalog = createCatalogStore(db);
    catalog.activateSnapshot(1);
    const service = createBaseVersionService({
      store,
      fetchImpl: fakeFetch(),
      refresh: vi.fn(async () => {
        throw new Error("feed refresh failed");
      }),
      submitSmoke: vi.fn(),
      activeSnapshotId: () => catalog.getActiveSnapshot()?.id ?? null,
      activateSnapshot: (id) => catalog.activateSnapshot(id),
    });

    await service.checkForNewRelease();
    await service.bump("25.12.3");
    await vi.waitFor(() => expect(service.readState().smoke?.phase).toBe("failed"));

    const state = service.readState();
    expect(state.active?.version).toBe("25.12.2");
    expect(state.previous).toBeNull();
    expect(state.smoke?.error).toContain("feed refresh failed");
    expect(catalog.getActiveSnapshot()?.id).toBe(1);
    db.close();
  });

  it("requires the candidate to be discovered before bumping", async () => {
    const db = database();
    const service = createBaseVersionService({
      store: createBaseVersionStore(db),
      fetchImpl: fakeFetch(),
      refresh: vi.fn(),
      submitSmoke: vi.fn(),
    });
    await expect(service.bump("25.12.3")).rejects.toThrow(/check for a new release/);
    db.close();
  });
});
