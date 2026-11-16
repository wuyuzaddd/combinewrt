import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrate, openDatabase } from "../db";
import { ARTIFACT_SIZE_LIMIT_BYTES, ArtifactSizeLimitError } from "../image/postprocess";
import { createArtifactCache, reconcileArtifactCache, sanitizeArtifactFilename } from "./artifact-cache";
import { createArtifactCacheStore } from "./artifact-store";

const dirs: string[] = [];
const dbs: DatabaseSync[] = [];

function cacheDirectory(): string {
  const dir = mkdtempSync(join(tmpdir(), "cw-artifact-cache-"));
  dirs.push(dir);
  return dir;
}

function store(): ReturnType<typeof createArtifactCacheStore> {
  const db = openDatabase(":memory:");
  migrate(db);
  dbs.push(db);
  return createArtifactCacheStore(db);
}

function body(text: string): { body: Uint8Array; name: string; contentType: string; size: number } {
  return { body: new Uint8Array(Buffer.from(text)), name: "img.gz", contentType: "application/gzip", size: text.length };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  for (const db of dbs.splice(0)) db.close();
});

describe("createArtifactCache", () => {
  it("archives bytes, hashes them and records the index entry", async () => {
    const dir = cacheDirectory();
    const cache = createArtifactCache({ dir, store: store() });
    const bytes = Buffer.from("firmware-bytes");

    const entry = await cache.archive("build-1", "image.img.gz", "combined", {
      name: "image.img.gz",
      contentType: "application/gzip",
      size: bytes.length,
      body: new Uint8Array(bytes),
    });

    expect(entry.buildId).toBe("build-1");
    expect(entry.filename).toBe("image.img.gz");
    expect(entry.kind).toBe("combined");
    expect(entry.size).toBe(bytes.length);
    expect(entry.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(existsSync(entry.path)).toBe(true);
    expect(entry.path).toBe(join(dir, "build-1", "image.img.gz"));
  });

  it("streams a chunked body and survives a restart", async () => {
    const dir = cacheDirectory();
    const db = openDatabase(":memory:");
    migrate(db);
    dbs.push(db);
    const chunks = [new Uint8Array([1, 2]), new Uint8Array([3, 4, 5])];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });

    const first = createArtifactCache({ dir, store: createArtifactCacheStore(db) });
    await first.archive("build-2", "rootfs.img", "rootfs", {
      name: "rootfs.img",
      contentType: "application/octet-stream",
      body,
    });

    // A new process must find the artifact through the persisted index.
    const restarted = createArtifactCache({ dir, store: createArtifactCacheStore(db) });
    const found = restarted.lookup("build-2", "rootfs.img");
    expect(found?.size).toBe(5);
    expect(found?.path).toBe(join(dir, "build-2", "rootfs.img"));
  });

  it("rejects a declared size above the cap without writing a file", async () => {
    const dir = cacheDirectory();
    const cache = createArtifactCache({ dir, store: store() });

    await expect(
      cache.archive("build-3", "huge.vmdk", "vmdk", {
        name: "huge.vmdk",
        contentType: "application/octet-stream",
        size: ARTIFACT_SIZE_LIMIT_BYTES + 1,
        body: new Uint8Array([1]),
      }),
    ).rejects.toBeInstanceOf(ArtifactSizeLimitError);

    expect(existsSync(join(dir, "build-3"))).toBe(false);
    expect(cache.stats().entries).toBe(0);
  });

  it("aborts a stream that grows past the cap and leaves no partial file", async () => {
    const dir = cacheDirectory();
    const cache = createArtifactCache({ dir, store: store(), limitBytes: 4 });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.enqueue(new Uint8Array([4, 5, 6]));
        controller.close();
      },
    });

    await expect(
      cache.archive("build-4", "big.qcow2", "qcow2", {
        name: "big.qcow2",
        contentType: "application/octet-stream",
        body,
      }),
    ).rejects.toBeInstanceOf(ArtifactSizeLimitError);

    expect(cache.lookup("build-4", "big.qcow2")).toBeNull();
    expect(cache.stats().entries).toBe(0);
    const buildDir = join(dir, "build-4");
    expect(existsSync(buildDir) ? readdirSync(buildDir) : []).toEqual([]);
    const staging = join(dir, ".staging");
    expect(existsSync(staging) ? readdirSync(staging) : []).toEqual([]);
  });

  it("keeps traversal attempts inside the cache directory", async () => {
    const dir = cacheDirectory();
    const cache = createArtifactCache({ dir, store: store() });

    const entry = await cache.archive("build-5", "../../evil.img", "combined", {
      name: "../../evil.img",
      contentType: "application/octet-stream",
      body: new Uint8Array([1]),
    });

    expect(sanitizeArtifactFilename("../../evil.img")).toBe("evil.img");
    expect(entry.filename).toBe("evil.img");
    expect(entry.path.startsWith(dir)).toBe(true);
    expect(existsSync(join(dir, "..", "evil.img"))).toBe(false);
  });

  it("serves a legacy <build>.zip cache file", async () => {
    const dir = cacheDirectory();
    const buildId = "55555555-5555-4555-8555-555555555555";
    const legacy = join(dir, `${buildId}.zip`);
    writeFileSync(legacy, "zip-bytes");
    const cache = createArtifactCache({ dir, store: store() });

    const found = cache.lookup(buildId, "some-artifact.zip");
    expect(found?.path).toBe(legacy);
    expect(found?.size).toBe(9);
    expect(cache.stats()).toEqual({ entries: 1, bytes: 9 });
  });

  it("reports cache statistics", async () => {
    const dir = cacheDirectory();
    const cache = createArtifactCache({ dir, store: store() });
    await cache.archive("b1", "one.gz", "combined", body("12345"));
    await cache.archive("b2", "two.gz", "combined", body("1234567"));
    expect(cache.stats()).toEqual({ entries: 2, bytes: 12 });
  });
});

describe("reconcileArtifactCache", () => {
  it("drops index rows whose file is missing and adopts orphan files", async () => {
    const dir = cacheDirectory();
    const index = store();
    mkdirSync(join(dir, "keep"), { recursive: true });
    mkdirSync(join(dir, "gone"), { recursive: true });
    writeFileSync(join(dir, "keep", "kept.img"), "abc");
    index.put({
      buildId: "keep",
      filename: "kept.img",
      relativePath: "keep/kept.img",
      kind: "combined",
      size: 3,
      sha256: null,
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z",
    });
    index.put({
      buildId: "gone",
      filename: "gone.img",
      relativePath: "gone/gone.img",
      kind: "combined",
      size: 3,
      sha256: null,
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z",
    });

    mkdirSync(join(dir, "orphan"), { recursive: true });
    writeFileSync(join(dir, "orphan", "adopted.img"), "hello");
    mkdirSync(join(dir, ".staging"), { recursive: true });
    const stale = join(dir, ".staging", "crash.part");
    writeFileSync(stale, "partial");
    const past = new Date("2026-11-01T00:00:00Z");
    utimesSync(stale, past, past);
    const fresh = join(dir, ".staging", "inflight.part");
    writeFileSync(fresh, "partial");

    const result = reconcileArtifactCache({ dir, store: index, now: new Date("2026-11-15T00:00:00Z") });

    expect(result.dropped).toBe(1);
    expect(result.adopted).toBe(1);
    expect(index.get("gone", "gone.img")).toBeNull();
    expect(index.get("keep", "kept.img")?.size).toBe(3);
    expect(index.get("orphan", "adopted.img")?.size).toBe(5);
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });

  it("drops a row whose file shrank on disk", async () => {
    const dir = cacheDirectory();
    const index = store();
    mkdirSync(join(dir, "b1"), { recursive: true });
    writeFileSync(join(dir, "b1", "a.img"), "short");
    index.put({
      buildId: "b1",
      filename: "a.img",
      relativePath: "b1/a.img",
      kind: "combined",
      size: 999,
      sha256: null,
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z",
    });

    reconcileArtifactCache({ dir, store: index });

    // The orphan scan re-adopts the file with its real size, so the index
    // matches disk rather than the stale row.
    expect(index.get("b1", "a.img")?.size).toBe(5);
  });
});
