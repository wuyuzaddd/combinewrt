import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { BuildPlan } from "../build/types";
import { ArtifactSizeLimitError, artifactSizeLimitBytes, assertArtifactSize } from "../image/postprocess";
import type { ArtifactCache } from "./artifact-cache";
import type { ArtifactCacheEntry } from "./artifact-store";
import { createDispatchPayloadCodec, type DispatchPayloadCodec } from "./dispatch-payload";
import { createBuildQueue } from "./queue";
import type { BuildStore } from "./store";
import type { ArtifactDownload, BuildAdapter, BuildRecord, BuildStatus } from "./types";
import { buildEngineOf } from "./types";

const LOG_LIMIT = 20_000;

/** How long a dispatched build may lack a run id before it is called a phantom. */
const DISPATCH_GRACE_MS = 120_000;

function isTerminal(status: BuildStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

function tail(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  return text.length > LOG_LIMIT ? text.slice(-LOG_LIMIT) : text;
}

export interface BuildService {
  /** Enqueue the plan and dispatch it if a slot is free (ticket 13). */
  submit(plan: BuildPlan): Promise<BuildRecord>;
  /** Create a queued build row without dispatching it. */
  enqueue(plan: BuildPlan): BuildRecord;
  /** Dispatch queued builds FIFO up to the configured cap. */
  pump(): Promise<void>;
  list(limit?: number, offset?: number): BuildRecord[];
  get(id: string): BuildRecord | null;
  count(): number;
  /** 1-based FIFO position while the build waits for a dispatch slot; null otherwise. */
  queuePosition(id: string): number | null;
  refresh(id: string): Promise<BuildRecord | null>;
  cancel(id: string): Promise<BuildRecord | null>;
  refreshActive(limit?: number): Promise<BuildRecord[]>;
  listActive(limit?: number): BuildRecord[];
  artifact(id: string): Promise<ArtifactDownload | null>;
  /**
   * Resolve the cached artifact to an on-disk file for Range streaming. Returns
   * null when the build has no downloadable artifact or no cache is configured.
   */
  artifactFile(id: string): Promise<ArtifactFileInfo | null>;
}

/**
 * Metadata for a cached artifact file the download route can range over.
 *
 * Ticket 13: the cached bytes are the GitHub artifact ZIP container, not the
 * image inside it. `name`/`image*` describe the image from the build record;
 * `containerName`/`size`/`sha256` describe the bytes a Range request addresses.
 */
export interface ArtifactFileInfo {
  /** Image file name recorded by the build (what the container holds). */
  name: string;
  /** Filename served to the browser: the container, `<name>.zip`. */
  containerName: string;
  /** Always `application/zip`: the cached bytes are the artifact container. */
  contentType: string;
  /** Container byte count. */
  size: number;
  path: string;
  kind: string;
  /** Container sha256; null when it could not be determined. */
  sha256: string | null;
  /** Image digest from the build record, for the `X-Image-*` headers. */
  imageSha256: string | null;
  /** Image byte count from the build record. */
  imageSize: number | null;
}

/**
 * The browser-facing filename of the artifact container. Names that already end
 * in `.zip` (legacy rows stored the container name directly) are left alone so
 * a download never becomes `*.zip.zip`.
 */
export function artifactContainerName(imageName: string): string {
  return /\.zip$/i.test(imageName) ? imageName : `${imageName}.zip`;
}

/** Streaming sha256 of a file on disk; used only when the cache index has none. */
async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/** Artifact container format from the plan variant, falling back to the name. */
export function artifactKindFor(record: Pick<BuildRecord, "plan" | "artifactName">): string {
  const variant = (record.plan as { imageVariant?: { artifact?: string } }).imageVariant;
  if (variant?.artifact) return variant.artifact;
  const name = record.artifactName ?? "";
  if (/\.vmdk$/i.test(name)) return "vmdk";
  if (/\.qcow2$/i.test(name)) return "qcow2";
  if (/\.img$/i.test(name)) return "rootfs";
  if (/\.zip$/i.test(name)) return "combined";
  return "combined";
}

export function artifactContentType(filename: string): string {
  if (/\.zip$/i.test(filename)) return "application/zip";
  if (/\.gz$/i.test(filename)) return "application/gzip";
  return "application/octet-stream";
}

export function createBuildService(options: {
  store: BuildStore;
  adapter: BuildAdapter;
  now?: () => Date;
  pollIntervalMs?: number;
  buildTimeoutMs?: number;
  cacheDir?: string;
  /** Site artifact cache with the persistent index; enables the 2 GiB cap. */
  cache?: ArtifactCache;
  /** Concurrency cap from MAX_CONCURRENT_BUILDS; defaults to 2. */
  maxConcurrentBuilds?: number;
  /**
   * Encrypts the full plan for later (possibly cross-process) dispatch.
   * `getBuildService()` passes `SESSION_SECRET`; tests may omit it and get a
   * process-local key, which is enough for same-instance queue semantics.
   */
  sessionSecret?: string;
  /** Test seam for a pre-created codec (e.g. a fixed key across two instances). */
  dispatchPayload?: DispatchPayloadCodec;
}): BuildService {
  const {
    store,
    adapter,
    now = () => new Date(),
    pollIntervalMs = 0,
    buildTimeoutMs = 60 * 60 * 1000,
    cacheDir,
    cache,
    maxConcurrentBuilds = 2,
  } = options;
  const inFlight = new Map<string, Promise<BuildRecord | null>>();
  const lastPoll = new Map<string, number>();
  // `SESSION_SECRET` is required in production (getBuildService passes it). A
  // process-local key keeps unit-test instances independent; a queued build
  // that crosses processes without a shared secret fails loudly at dispatch.
  const dispatchPayload =
    options.dispatchPayload ??
    createDispatchPayloadCodec(options.sessionSecret ?? randomBytes(32).toString("hex"));
  const queue = createBuildQueue({
    store,
    adapter,
    dispatchPayload,
    maxConcurrent: maxConcurrentBuilds,
    now,
  });

  function engineOf(record: BuildRecord): ReturnType<typeof buildEngineOf> {
    return record.engine ?? buildEngineOf(record.plan);
  }

  function needsEnrichment(record: BuildRecord): boolean {
    if (isTerminal(record.status) === false) return false;
    if (record.status === "cancelled") return false;
    if (Date.now() - Date.parse(record.updatedAt) > 60 * 60 * 1000) return false;
    return record.status === "succeeded" ? !record.artifactName : !record.logTail;
  }

  function refresh(id: string): Promise<BuildRecord | null> {
    const record = store.get(id);
    if (!record) return Promise.resolve(null);
    // The queue owns queued builds. A read never dispatches and never fails a
    // build that is simply waiting for a slot (ticket 13).
    if (record.status === "queued") return Promise.resolve(record);
    if (isTerminal(record.status) && !needsEnrichment(record)) return Promise.resolve(record);

    const running = inFlight.get(id);
    if (running) return running;

    const nowMs = Date.now();
    if (pollIntervalMs > 0 && nowMs - (lastPoll.get(id) ?? 0) < pollIntervalMs) {
      return Promise.resolve(record);
    }
    lastPoll.set(id, nowMs);

    const pending = pollOnce(id).finally(() => inFlight.delete(id));
    inFlight.set(id, pending);
    return pending;
  }

  async function pollOnce(id: string): Promise<BuildRecord | null> {
    const record = store.get(id);
    if (!record) return null;
    if (record.status === "queued") return record;
    if (isTerminal(record.status) && !needsEnrichment(record)) return record;

    // Time only counts once a build has left the queue; a queued build may wait
    // behind the concurrency cap for hours without being "timed out".
    const dispatchedAt = Date.parse(record.dispatchedAt ?? record.createdAt);
    if (record.status === "running" && now().getTime() - dispatchedAt > buildTimeoutMs) {
      const minutes = Math.round(buildTimeoutMs / 60_000);
      const updated = store.update(id, {
        status: "failed",
        error: `构建超过 ${minutes} 分钟仍未完成，已标记为超时`,
        failure: {
          step: "timeout",
          package: null,
          source: null,
          version: null,
          message: `build did not finish within ${minutes} minutes`,
        },
      }, record.updatedAt, "timeout");
      await pump();
      return updated;
    }

    if (!record.runId) {
      if (now().getTime() - dispatchedAt > DISPATCH_GRACE_MS) {
        const found = await adapter.findRun(record.id, engineOf(record));
        if (found) return store.update(id, { runId: found }, record.updatedAt, "dispatch");
        const updated = store.update(
          id,
          {
            status: "failed",
            error: "no workflow run matched this build after 2 minutes; check the build repository before resubmitting",
            failure: {
              step: "dispatch",
              package: null,
              source: null,
              version: null,
              message: "no workflow run matched this build after 2 minutes",
            },
          },
          record.updatedAt,
          "dispatch",
        );
        await pump();
        return updated;
      }
      return record;
    }

    try {
      const update = await adapter.getRun(record.runId, record.plan.artifactName);
      // GitHub reports its own "queued" run state for a while after the
      // dispatch. A dispatched build must never fall back into the site queue,
      // otherwise the same build would be dispatched twice.
      const status =
        update.status === "queued" && record.status === "running" ? "running" : update.status;
      const updated = store.update(
        id,
        {
          status,
          logTail: tail(update.logTail) ?? record.logTail,
          error: update.error ?? null,
          failure: update.failure ?? record.failure ?? null,
          artifactName: update.artifactName ?? record.artifactName,
          artifactSha256: update.artifactSha256 ?? record.artifactSha256 ?? null,
          artifactSize: update.artifactSize ?? record.artifactSize ?? null,
        },
        record.updatedAt,
      );
      // A finished build frees a concurrency slot; dispatch the next queued one.
      if (isTerminal(updated.status)) await pump();
      return updated;
    } catch (error) {
      return store.update(
        id,
        { error: error instanceof Error ? error.message : String(error) },
        record.updatedAt,
      );
    }
  }

  function pump(): Promise<void> {
    return queue.pump();
  }

  return {
    async submit(plan) {
      const record = queue.enqueue(plan);
      await queue.pump();
      return store.get(record.id) ?? record;
    },

    enqueue(plan) {
      return queue.enqueue(plan);
    },

    pump,

    list(limit, offset) {
      return store.list(limit, offset);
    },
    get(id) {
      return store.get(id);
    },
    count() {
      return store.count();
    },
    queuePosition(id) {
      return store.queuePosition(id);
    },

    listActive(limit) {
      return store.listActive(limit);
    },

    async refreshActive(limit = 20) {
      // Queued builds are the queue's responsibility, not a poll's.
      const active = store.listActive(limit).filter((build) => build.status !== "queued");
      await Promise.allSettled(active.map((build) => refresh(build.id)));
      return store.list(limit);
    },

    refresh,

    async cancel(id) {
      const record = store.get(id);
      if (!record) return null;
      if (isTerminal(record.status)) return record;

      if (record.status === "queued") {
        // Never dispatched: cancel in place, no GitHub call.
        return store.update(id, { status: "cancelled", error: null }, record.updatedAt, "cancel");
      }

      if (record.runId && adapter.cancelRun) {
        try {
          await adapter.cancelRun(record.runId);
        } catch (error) {
          return store.update(
            id,
            { error: error instanceof Error ? error.message : String(error) },
            record.updatedAt,
          );
        }
      }

      let logTail = record.logTail;
      if (record.runId) {
        try {
          const update = await adapter.getRun(record.runId);
          logTail = tail(update.logTail) ?? logTail;
        } catch {
          // cancellation already accepted; keep the last known log tail
        }
      }
      let updated = store.update(
        id,
        { status: "cancelled", logTail, error: null },
        record.updatedAt,
        "cancel",
      );
      if (updated.status !== "cancelled") {
        const latest = store.get(id);
        if (latest && !isTerminal(latest.status)) {
          // The dispatch may have recorded a run id between our read and the
          // update; cancel that run too, or it would keep building invisibly.
          if (latest.runId && latest.runId !== record.runId && adapter.cancelRun) {
            try {
              await adapter.cancelRun(latest.runId);
            } catch (error) {
              return store.update(
                id,
                { error: error instanceof Error ? error.message : String(error) },
                latest.updatedAt,
              );
            }
          }
          updated = store.update(
            id,
            { status: "cancelled", logTail, error: null },
            latest.updatedAt,
            "cancel",
          );
        }
      }
      // Cancelling a running build frees a slot for the next queued build. This
      // runs in the background: a cancel request must not wait for the next
      // dispatch (which may spend seconds resolving its run id).
      void pump().catch((error) => console.error("[combinewrt] queue pump after cancel failed", error));
      return updated;
    },

    async artifact(id) {
      const record = await refresh(id);
      if (!record || record.status !== "succeeded" || !record.runId || !record.artifactName) return null;

      const cached = cachedEntry(record);
      if (cached) return streamEntry(cached, record);

      const download = await adapter.downloadArtifact(record.runId, record.artifactName);
      if (typeof download.size === "number") assertArtifactSize(download.size, artifactSizeLimitBytes());

      if (cache) {
        try {
          const entry = await cache.archive(id, record.artifactName, artifactKindFor(record), download);
          return streamEntry(entry, record);
        } catch (error) {
          if (error instanceof ArtifactSizeLimitError) throw error;
          console.error("artifact cache failed", error);
          throw error;
        }
      }

      if (!cacheDir) return download;

      const cachedPath = join(cacheDir, `${id}.zip`);
      try {
        mkdirSync(cacheDir, { recursive: true });
        const tmp = `${cachedPath}.${randomUUID()}.tmp`;
        try {
          if (download.body instanceof Uint8Array) {
            writeFileSync(tmp, download.body);
          } else {
            await pipeline(Readable.fromWeb(download.body as never), createWriteStream(tmp));
          }
          renameSync(tmp, cachedPath);
        } catch (error) {
          rmSync(tmp, { force: true });
          throw error;
        }
        return {
          ...download,
          size: statSync(cachedPath).size,
          body: Readable.toWeb(createReadStream(cachedPath)) as ReadableStream<Uint8Array>,
        };
      } catch (error) {
        console.error("artifact cache failed", error);
        throw error;
      }
    },

    async artifactFile(id) {
      const record = await refresh(id);
      if (!record || record.status !== "succeeded" || !record.runId || !record.artifactName) return null;

      const cached = cachedEntry(record);
      if (cached) return finalizeFile(cached, record);
      // Without an index a downloaded artifact may only exist as a stream.
      if (!cache) return null;

      const download = await adapter.downloadArtifact(record.runId, record.artifactName);
      if (typeof download.size === "number") assertArtifactSize(download.size, artifactSizeLimitBytes());
      const entry = await cache.archive(id, record.artifactName, artifactKindFor(record), download);
      return finalizeFile(entry, record);
    },
  };

  function cachedEntry(record: BuildRecord): ArtifactCacheEntry | null {
    const filename = record.artifactName as string;
    if (cache) {
      const found = cache.lookup(record.id, filename);
      if (found) return found;
    }
    if (!cacheDir) return null;
    const timestamp = new Date().toISOString();
    for (const candidate of [join(cacheDir, `${record.id}.zip`), join(cacheDir, record.id, filename)]) {
      if (!existsSync(candidate)) continue;
      return {
        buildId: record.id,
        filename,
        relativePath: candidate.slice(cacheDir.length + 1),
        kind: artifactKindFor(record),
        size: statSync(candidate).size,
        sha256: record.artifactSha256 ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
        path: candidate,
      };
    }
    return null;
  }

  function toFileInfo(entry: ArtifactCacheEntry, record: BuildRecord): ArtifactFileInfo {
    const name = record.artifactName as string;
    return {
      name,
      containerName: artifactContainerName(name),
      contentType: "application/zip",
      size: entry.size,
      path: entry.path,
      kind: entry.kind,
      sha256: entry.sha256,
      imageSha256: record.artifactSha256 ?? null,
      imageSize: typeof record.artifactSize === "number" ? record.artifactSize : null,
    };
  }

  /**
   * Fill in the container digest and remember it on the build row (ticket 13).
   * A cache-index entry already carries the sha256 of the bytes it wrote; a
   * legacy flat `<id>.zip` file has no index row, so it is hashed once here.
   * The image facts (`artifact_sha256`/`artifact_size`) are never overwritten.
   */
  async function finalizeFile(entry: ArtifactCacheEntry, record: BuildRecord): Promise<ArtifactFileInfo> {
    const file = toFileInfo(entry, record);
    const remembered =
      file.sha256 !== null &&
      record.artifactContainerSha256 === file.sha256 &&
      record.artifactContainerSize === file.size;
    if (!remembered) {
      file.sha256 ??= await sha256File(file.path);
      store.noteArtifactContainer(record.id, { sha256: file.sha256, size: file.size });
    }
    return file;
  }

  function streamEntry(entry: ArtifactCacheEntry, record: BuildRecord): ArtifactDownload {
    return {
      name: artifactContainerName(record.artifactName as string),
      contentType: "application/zip",
      size: entry.size,
      body: Readable.toWeb(createReadStream(entry.path)) as ReadableStream<Uint8Array>,
    };
  }
}
