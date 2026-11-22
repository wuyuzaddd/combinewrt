import { createHash, randomUUID } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ARTIFACT_SIZE_LIMIT_BYTES, ArtifactSizeLimitError, formatBytes, assertArtifactSize } from "../image/postprocess";
import type { ArtifactCacheEntry, ArtifactCacheStats, ArtifactCacheStore } from "./artifact-store";
import type { ArtifactDownload } from "./types";
import { extractSingleFile } from "./zip";

/**
 * Site artifact cache (ticket 14).
 *
 * Layout: `<root>/<buildId>/<filename>` with writes staged under
 * `<root>/.staging` and published by rename, so a crash can leave a stray
 * `.part` file but never a half-written cache entry. The SQLite index is
 * updated only after the rename; `reconcileArtifactCache` fixes the index when
 * the process died between rename and upsert (or when files were removed).
 *
 * The per-artifact cap (`limitBytes`, from `ARTIFACT_MAX_BYTES`; 2 GiB by
 * default) is enforced on the declared size before anything is written and
 * again on the byte count while streaming, so a lying Content-Length cannot
 * fill the disk. `ArtifactSizeLimitError` is the only rejection; callers get a
 * readable message with both sizes.
 */

/** Legacy flat cache files written by earlier versions: `<build-id>.zip`. */
const LEGACY_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.zip$/i;

const STAGING_DIR = ".staging";
const STALE_STAGING_MS = 60 * 60 * 1000;

function sanitizeSegment(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "");
  return cleaned || "artifact";
}

/** Keep only the final path segment so traversal cannot escape the cache root. */
export function sanitizeArtifactFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, "").replace(/^\.+/, "");
  return cleaned || "artifact.bin";
}

export interface ArtifactCache {
  archive(
    buildId: string,
    filename: string,
    kind: string,
    download: ArtifactDownload,
  ): Promise<ArtifactCacheEntry>;
  lookup(buildId: string, filename: string): ArtifactCacheEntry | null;
  stats(): ArtifactCacheStats;
}

export function createArtifactCache(options: {
  dir: string;
  store: ArtifactCacheStore;
  limitBytes?: number;
  now?: () => Date;
}): ArtifactCache {
  const { dir, store, limitBytes = ARTIFACT_SIZE_LIMIT_BYTES, now = () => new Date() } = options;
  const stagingDir = join(dir, STAGING_DIR);

  function entryFor(row: Omit<ArtifactCacheEntry, "path">): ArtifactCacheEntry {
    return { ...row, path: join(dir, row.relativePath) };
  }

  return {
    async archive(buildId, filename, kind, download) {
      const safeBuild = sanitizeSegment(buildId);
      const safeName = sanitizeArtifactFilename(filename);

      // Reject a declared over-cap artifact before touching the filesystem.
      if (typeof download.size === "number") assertArtifactSize(download.size, limitBytes);

      mkdirSync(join(dir, safeBuild), { recursive: true });
      mkdirSync(stagingDir, { recursive: true });
      const temp = join(stagingDir, `${safeBuild}-${randomUUID()}.part`);
      const hash = createHash("sha256");
      let written = 0;

      try {
        if (download.body instanceof Uint8Array) {
          written = download.body.byteLength;
          assertArtifactSize(written, limitBytes);
          hash.update(download.body);
          writeFileSync(temp, download.body);
        } else {
          const source = Readable.fromWeb(download.body as never);
          const meter = new Transform({
            transform(chunk: Buffer, _encoding, callback) {
              written += chunk.length;
              if (written > limitBytes) {
                callback(new ArtifactSizeLimitError(written, limitBytes));
                return;
              }
              hash.update(chunk);
              callback(null, chunk);
            },
          });
          await pipeline(source, meter, createWriteStream(temp));
        }

        // GitHub serves workflow artifacts as a ZIP that holds exactly one
        // file. Unpack it once here so the download is the real image: its own
        // name, its own content type and the checksum of the bytes the browser
        // receives. A ZIP that is not a single-file archive stays as it is.
        const zipName = /\.zip$/i.test(safeName);
        const containerName = zipName ? safeName : `${safeName}.zip`;
        const containerPath = join(dir, safeBuild, containerName);
        renameSync(temp, containerPath);

        const timestamp = now().toISOString();
        const containerSha256 = hash.digest("hex");
        let stored = {
          filename: containerName,
          relativePath: `${safeBuild}/${containerName}`,
          size: written,
          sha256: containerSha256 as string | null,
        };

        if (!zipName) {
          const imagePath = join(dir, safeBuild, safeName);
          const extracted = await extractSingleFile(containerPath, imagePath, safeName);
          if (extracted) {
            if (extracted.size > limitBytes) {
              // The compressed container fit but the image itself does not:
              // keep the container rather than exceeding the cache budget.
              rmSync(imagePath, { force: true });
            } else {
              rmSync(containerPath, { force: true });
              stored = {
                filename: safeName,
                relativePath: `${safeBuild}/${safeName}`,
                size: extracted.size,
                sha256: extracted.sha256,
              };
            }
          }
        }

        const row = {
          buildId: safeBuild,
          filename: stored.filename,
          relativePath: stored.relativePath,
          kind,
          size: stored.size,
          sha256: stored.sha256,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        store.put(row);
        return entryFor(row);
      } catch (error) {
        rmSync(temp, { force: true });
        if (error instanceof ArtifactSizeLimitError) throw error;
        throw error;
      }
    },

    lookup(buildId, filename) {
      const safeBuild = sanitizeSegment(buildId);
      const safeName = sanitizeArtifactFilename(filename);
      const row = store.get(safeBuild, safeName);
      if (row) {
        const path = join(dir, row.relativePath);
        if (existsSync(path)) return { ...row, path };
        // Disk is authoritative: drop the row that points at nothing.
        store.delete(safeBuild, safeName);
      }

      const legacy = join(dir, `${safeBuild}.zip`);
      if (existsSync(legacy)) {
        const stat = statSync(legacy);
        const timestamp = stat.mtime.toISOString();
        return {
          buildId: safeBuild,
          filename: `${safeBuild}.zip`,
          relativePath: `${safeBuild}.zip`,
          kind: "combined",
          size: stat.size,
          sha256: null,
          createdAt: timestamp,
          updatedAt: timestamp,
          path: legacy,
        };
      }
      return null;
    },

    stats() {
      let entries = 0;
      let bytes = 0;
      const seen = new Set<string>();

      for (const row of store.list()) {
        const path = join(dir, row.relativePath);
        if (!existsSync(path)) continue;
        entries += 1;
        bytes += statSync(path).size;
        seen.add(path);
      }

      if (existsSync(dir)) {
        for (const dirent of readdirSync(dir, { withFileTypes: true })) {
          if (!dirent.isFile() || !LEGACY_FILE.test(dirent.name)) continue;
          const path = join(dir, dirent.name);
          if (seen.has(path)) continue;
          entries += 1;
          bytes += statSync(path).size;
        }
      }

      return { entries, bytes };
    },
  };
}

export interface ReconcileResult {
  dropped: number;
  adopted: number;
  stagingRemoved: number;
}

/**
 * Make the index match the disk: drop rows whose file vanished or changed
 * size, adopt files nobody indexed (orphans, restored backups, legacy flat
 * zips), and remove abandoned staging files. Returns counts for logging.
 */
export function reconcileArtifactCache(options: {
  dir: string;
  store: ArtifactCacheStore;
  now?: Date;
  staleStagingMs?: number;
}): ReconcileResult {
  const { dir, store, now = new Date(), staleStagingMs = STALE_STAGING_MS } = options;
  let dropped = 0;
  let adopted = 0;
  let stagingRemoved = 0;

  if (existsSync(dir)) {
    for (const row of store.list()) {
      const path = join(dir, row.relativePath);
      if (!existsSync(path)) {
        store.delete(row.buildId, row.filename);
        dropped += 1;
        continue;
      }
      if (statSync(path).size !== row.size) {
        // Adopt the real file below instead of trusting the stale size.
        store.delete(row.buildId, row.filename);
        dropped += 1;
      }
    }

    for (const dirent of readdirSync(dir, { withFileTypes: true })) {
      if (!dirent.isDirectory() || dirent.name === STAGING_DIR) continue;
      const buildDir = join(dir, dirent.name);
      for (const file of readdirSync(buildDir, { withFileTypes: true })) {
        if (!file.isFile()) continue;
        if (store.get(dirent.name, file.name)) continue;
        const path = join(buildDir, file.name);
        const stat = statSync(path);
        const timestamp = new Date(stat.mtimeMs).toISOString();
        store.put({
          buildId: dirent.name,
          filename: file.name,
          relativePath: `${dirent.name}/${file.name}`,
          kind: "combined",
          size: stat.size,
          sha256: null,
          createdAt: timestamp,
          updatedAt: now.toISOString(),
        });
        adopted += 1;
      }
    }

    for (const dirent of readdirSync(dir, { withFileTypes: true })) {
      if (!dirent.isFile() || !LEGACY_FILE.test(dirent.name)) continue;
      const buildId = dirent.name.slice(0, -4);
      if (store.get(buildId, dirent.name)) continue;
      const stat = statSync(join(dir, dirent.name));
      const timestamp = new Date(stat.mtimeMs).toISOString();
      store.put({
        buildId,
        filename: dirent.name,
        relativePath: dirent.name,
        kind: "combined",
        size: stat.size,
        sha256: null,
        createdAt: timestamp,
        updatedAt: now.toISOString(),
      });
      adopted += 1;
    }

    const stagingDir = join(dir, STAGING_DIR);
    if (existsSync(stagingDir)) {
      for (const dirent of readdirSync(stagingDir, { withFileTypes: true })) {
        const path = join(stagingDir, dirent.name);
        if (!dirent.isFile()) continue;
        if (now.getTime() - statSync(path).mtimeMs > staleStagingMs) {
          rmSync(path, { force: true });
          stagingRemoved += 1;
        }
      }
    }
  }

  return { dropped, adopted, stagingRemoved };
}

/** Human readable cache line used by the admin page and logs. */
export function describeCacheStats(stats: ArtifactCacheStats): string {
  return `${stats.entries} artifact(s), ${formatBytes(stats.bytes)}`;
}
