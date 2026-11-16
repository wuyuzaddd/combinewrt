import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrate, openDatabase } from "../db";
import { createDllkidsRepoRefWatcher } from "./dllkids";
import { sha256Hex } from "./observe";
import { createSourceWatchService, type SourceWatchService } from "./service";
import type { SourcePinRefreshInput } from "./types";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "combinewrt-watch-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const HEX_A = "a".repeat(64);
const HEX_B = "b".repeat(64);
const HEX_C = "c".repeat(64);

interface FixturePackage {
  name: string;
  version: string;
  sha: string | null;
}

function dumpOf(packages: FixturePackage[], declared = packages.length): string {
  const lines = [`packages: # ${declared} items`];
  for (const pkg of packages) {
    lines.push(`  - name: ${pkg.name}`);
    lines.push(`    version: ${pkg.version}`);
    if (pkg.sha) lines.push(`    hashes: ${pkg.sha}`);
  }
  return `${lines.join("\n")}\n`;
}

interface Harness {
  db: DatabaseSync;
  service: SourceWatchService;
  refreshLog: SourcePinRefreshInput[];
  seedActive(pin: string): void;
  setPayload(dump: string): string;
  failFetch(message: string | null): void;
  failRefresh(fail: boolean): void;
}

function harness(): Harness {
  const db = openDatabase(":memory:");
  migrate(db);
  const cacheDir = tempDir();
  const dumps = new Map<string, string>();
  let payload: Buffer | null = null;
  let fetchError: string | null = null;
  let refreshFails = false;
  const clock = new Date("2026-11-15T00:00:00.000Z");
  const refreshLog: SourcePinRefreshInput[] = [];

  const fetchImpl = (async () => {
    if (fetchError) throw new Error(fetchError);
    if (!payload) return new Response("missing", { status: 503 });
    return new Response(new Uint8Array(payload));
  }) as typeof fetch;

  const refresh = async (input: SourcePinRefreshInput) => {
    refreshLog.push(input);
    if (refreshFails) throw new Error("catalog refresh failed");
    const result = db
      .prepare(
        `INSERT INTO catalog_snapshots (base_version, feed_commit, source_note, profile_count, package_count)
         VALUES (?, ?, ?, 0, 0)`,
      )
      .run("25.12.2", `feed-${refreshLog.length}`, "source-watch fixture");
    return { snapshotId: Number(result.lastInsertRowid) };
  };

  const service = createSourceWatchService({
    db,
    cacheDir,
    watcher: createDllkidsRepoRefWatcher({
      baseUrl: "https://feed.test/x86_64",
      fetchImpl,
      now: () => clock,
      runAdbDump: async (bytes) => {
        const dump = dumps.get(sha256Hex(bytes));
        if (!dump) throw new Error(`no fixture dump for ${sha256Hex(bytes)}`);
        return dump;
      },
    }),
    refresh,
    intervalMs: 6 * 60 * 60 * 1000,
    now: () => clock,
  });

  return {
    db,
    service,
    refreshLog,
    seedActive(pin) {
      db.prepare(
        `INSERT INTO source_pins (source, status, value, metadata_json)
         VALUES ('dllkids', 'active', ?, '{}')`,
      ).run(pin);
    },
    setPayload(dump) {
      const bytes = Buffer.from(dump);
      dumps.set(sha256Hex(bytes), dump);
      payload = bytes;
      return sha256Hex(bytes);
    },
    failFetch(message) {
      fetchError = message;
    },
    failRefresh(fail) {
      refreshFails = fail;
    },
  };
}

function payloadA(): string {
  return dumpOf([{ name: "luci", version: "1.0", sha: HEX_A }]);
}

function events(db: DatabaseSync, reason?: string) {
  const rows = db
    .prepare("SELECT * FROM source_pin_events ORDER BY id")
    .all() as unknown as Array<Record<string, unknown>>;
  return reason ? rows.filter((row) => row.reason === reason) : rows;
}

/** Seed active pin A plus its cached baseline bytes. */
async function baseline(h: Harness): Promise<string> {
  const pin = h.setPayload(payloadA());
  h.seedActive(pin);
  const result = await h.service.check();
  expect(result.status).toBe("unchanged");
  expect(h.service.readOverview().active?.cachePath).not.toBeNull();
  return pin;
}

describe("source watch service", () => {
  it("auto-adopts a safe dllkids change and records the pin history", async () => {
    const h = harness();
    const pinA = await baseline(h);
    expect(h.refreshLog).toHaveLength(0);

    const pinB = h.setPayload(
      dumpOf([
        { name: "luci", version: "1.1", sha: HEX_B },
        { name: "kmod-foo", version: "1.0", sha: HEX_C },
      ]),
    );
    const result = await h.service.check();

    expect(result.status).toBe("adopted");
    expect(result.activePin).toBe(pinB);
    expect(result.diff?.upgraded).toEqual([{ name: "luci", from: "1.0", to: "1.1" }]);
    expect(result.diff?.added).toEqual(["kmod-foo"]);
    expect(h.refreshLog).toHaveLength(1);
    expect(h.refreshLog[0].pin).toBe(pinB);
    expect(sha256Hex(h.refreshLog[0].indexBytes)).toBe(pinB);

    const overview = h.service.readOverview();
    expect(overview.active?.value).toBe(pinB);
    expect(overview.candidate).toBeNull();
    expect(overview.history[0]).toMatchObject({
      fromPin: pinA,
      toPin: pinB,
      reason: "adopted",
      snapshotId: expect.any(Number),
    });
  });

  it("blocks a same-version package hash change and only adopts when forced", async () => {
    const h = harness();
    const pinA = await baseline(h);

    const pinB = h.setPayload(dumpOf([{ name: "luci", version: "1.0", sha: HEX_B }]));
    const blocked = await h.service.check();

    expect(blocked.status).toBe("blocked");
    expect(blocked.reason).toBe("same_version_hash_changed");
    expect(blocked.diff?.sameVersionHashChanges).toEqual([
      { name: "luci", version: "1.0", from: HEX_A, to: HEX_B },
    ]);
    expect(h.service.readOverview().active?.value).toBe(pinA);
    expect(h.service.readOverview().candidate?.value).toBe(pinB);
    expect(h.refreshLog).toHaveLength(0);
    expect(events(h.db, "blocked_same_version_hash")).toHaveLength(1);

    const refused = await h.service.adopt();
    expect(refused).toMatchObject({ ok: false, blocked: true, reason: "same_version_hash_changed" });
    expect(h.refreshLog).toHaveLength(0);

    const forced = await h.service.adopt({ force: true });
    expect(forced.ok).toBe(true);
    expect(h.refreshLog).toHaveLength(1);
    expect(h.service.readOverview().active?.value).toBe(pinB);
    expect(events(h.db, "adopted_forced")).toHaveLength(1);
  });

  it("blocks a change when no cached baseline exists to compare", async () => {
    const h = harness();
    // A config-seeded pin with no cached bytes cannot serve as a diff baseline.
    const pinA = h.setPayload(payloadA());
    h.seedActive(pinA);

    const pinB = h.setPayload(dumpOf([{ name: "luci", version: "1.0", sha: HEX_B }]));
    const result = await h.service.check();

    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("baseline_missing");
    expect(result.diff).toBeNull();
    expect(h.service.readOverview().active?.value).toBe(pinA);
    expect(h.service.readOverview().candidate?.value).toBe(pinB);
    expect(h.refreshLog).toHaveLength(0);
    expect(events(h.db, "blocked_baseline_missing")).toHaveLength(1);

    const refused = await h.service.adopt();
    expect(refused).toMatchObject({ ok: false, blocked: true, reason: "baseline_missing" });

    const forced = await h.service.adopt({ force: true });
    expect(forced.ok).toBe(true);
    expect(h.service.readOverview().active?.value).toBe(pinB);
  });

  it("rejects a partial parse and keeps the current pin", async () => {
    const h = harness();
    const pinA = await baseline(h);

    h.setPayload(dumpOf([{ name: "luci", version: "1.1", sha: HEX_B }], 3));
    const result = await h.service.check();

    expect(result.status).toBe("error");
    expect(result.error).toContain("refusing a partial snapshot");
    expect(h.service.readOverview().active?.value).toBe(pinA);
    expect(h.service.readOverview().candidate).toBeNull();
    expect(h.refreshLog).toHaveLength(0);
  });

  it("rolls the pin back when the catalog refresh fails", async () => {
    const h = harness();
    const pinA = await baseline(h);

    const pinB = h.setPayload(dumpOf([{ name: "luci", version: "1.1", sha: HEX_B }]));
    h.failRefresh(true);
    const result = await h.service.check();

    expect(result.status).toBe("error");
    expect(result.error).toContain("catalog refresh failed");
    const overview = h.service.readOverview();
    expect(overview.active?.value).toBe(pinA);
    expect(overview.candidate?.value).toBe(pinB);
    expect(events(h.db, "adoption_rolled_back")).toHaveLength(1);
    expect(overview.state.candidateReason).toBe("adoption_failed");
  });

  it("keeps the last good pin when upstream is unavailable and still rolls back offline", async () => {
    const h = harness();
    const pinA = await baseline(h);

    const pinB = h.setPayload(dumpOf([{ name: "luci", version: "1.1", sha: HEX_B }]));
    expect((await h.service.check()).status).toBe("adopted");
    expect(h.service.readOverview().active?.value).toBe(pinB);

    h.failFetch("upstream offline");
    const offline = await h.service.check();
    expect(offline.status).toBe("error");
    expect(offline.error).toContain("upstream offline");
    expect(h.service.readOverview().active?.value).toBe(pinB);

    // Rollback must not need the network: pin A's bytes are in the cache.
    const rolled = await h.service.rollback();
    expect(rolled.ok).toBe(true);
    expect(h.service.readOverview().active?.value).toBe(pinA);
    expect(events(h.db, "rolled_back")).toHaveLength(1);
    expect(sha256Hex(h.refreshLog.at(-1)!.indexBytes)).toBe(pinA);
  });

  it("runIfDue respects the six-hour interval", async () => {
    const h = harness();
    await baseline(h);
    const again = await h.service.runIfDue();
    expect(again.ran).toBe(false);
  });
});
