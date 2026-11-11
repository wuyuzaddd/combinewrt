import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { once } from "node:events";
import type { BuildPlan } from "../build/types";
import type { BuildStore } from "./store";
import type { ArtifactDownload, BuildAdapter, BuildRecord, BuildStatus } from "./types";

const LOG_LIMIT = 20_000;

function isTerminal(status: BuildStatus): boolean {
  return status === "succeeded" || status === "failed";
}

function tail(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  return text.length > LOG_LIMIT ? text.slice(-LOG_LIMIT) : text;
}

export interface BuildService {
  submit(plan: BuildPlan): Promise<BuildRecord>;
  list(limit?: number, offset?: number): BuildRecord[];
  get(id: string): BuildRecord | null;
  count(): number;
  refresh(id: string): Promise<BuildRecord | null>;
  cancel(id: string): Promise<BuildRecord | null>;
  refreshActive(limit?: number): Promise<BuildRecord[]>;
  listActive(limit?: number): BuildRecord[];
  artifact(id: string): Promise<ArtifactDownload | null>;
}

export function createBuildService(options: {
  store: BuildStore;
  adapter: BuildAdapter;
  now?: () => Date;
  pollIntervalMs?: number;
  cacheDir?: string;
}): BuildService {
  const { store, adapter, now = () => new Date(), pollIntervalMs = 0, cacheDir } = options;
  const inFlight = new Map<string, Promise<BuildRecord | null>>();
  const lastPoll = new Map<string, number>();

  function needsEnrichment(record: BuildRecord): boolean {
    if (isTerminal(record.status) === false) return false;
    if (Date.now() - Date.parse(record.updatedAt) > 60 * 60 * 1000) return false;
    return record.status === "succeeded" ? !record.artifactName : !record.logTail;
  }

  function refresh(id: string): Promise<BuildRecord | null> {
    const record = store.get(id);
    if (!record) return Promise.resolve(null);
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
    if (isTerminal(record.status) && !needsEnrichment(record)) return record;
    if (!record.runId) {
      const age = now().getTime() - Date.parse(record.createdAt);
      if (age > 120_000) {
        const found = await adapter.findRun(record.id);
        if (found) return store.update(id, { runId: found });
        return store.update(id, {
          status: "failed",
          error: "no workflow run matched this build after 2 minutes; check the build repository before resubmitting",
        });
      }
      return record;
    }

    try {
      const update = await adapter.getRun(record.runId, record.plan.artifactName);
      return store.update(
        id,
        {
          status: update.status,
          logTail: tail(update.logTail) ?? record.logTail,
          error: update.error ?? null,
          artifactName: update.artifactName ?? record.artifactName,
          artifactSha256: update.artifactSha256 ?? record.artifactSha256 ?? null,
          artifactSize: update.artifactSize ?? record.artifactSize ?? null,
        },
        record.updatedAt,
      );
    } catch (error) {
      return store.update(
        id,
        { error: error instanceof Error ? error.message : String(error) },
        record.updatedAt,
      );
    }
  }

  return {
    async submit(plan) {
      const id = randomUUID();
      const timestamp = now().toISOString();
      store.create({
        id,
        plan,
        config: plan.config ?? null,
        status: "queued",
        runId: null,
        adapter: adapter.name,
        logTail: "",
        error: null,
        artifactName: null,
        artifactSha256: null,
        artifactSize: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      try {
        const { runId } = await adapter.dispatch(plan, { buildId: id, artifactName: plan.artifactName });
        if (!runId) return store.get(id) ?? {
          id,
          plan,
          config: plan.config ?? null,
          status: "queued",
          runId: null,
          adapter: adapter.name,
          logTail: "",
          error: null,
          artifactName: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        return store.update(id, { runId });
      } catch (error) {
        return store.update(id, {
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },

    list(limit, offset) {
      return store.list(limit, offset);
    },
    get(id) {
      return store.get(id);
    },
    count() {
      return store.count();
    },

    listActive(limit) {
      return store.listActive(limit);
    },

    async refreshActive(limit = 20) {
      const active = store.listActive(limit);
      await Promise.allSettled(active.map((build) => refresh(build.id)));
      return store.list(limit);
    },

    refresh,

    async cancel(id) {
      const record = store.get(id);
      if (!record) return null;
      if (isTerminal(record.status)) return record;

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
      return store.update(id, { status: "cancelled", logTail, error: null }, record.updatedAt);
    },

    async artifact(id) {
      const record = await refresh(id);
      if (!record || record.status !== "succeeded" || !record.runId || !record.artifactName) return null;
      const download = await adapter.downloadArtifact(record.runId, record.artifactName);

      if (!cacheDir) return download;
      try {
        mkdirSync(cacheDir, { recursive: true });
        const path = join(cacheDir, `${id}.zip`);
        if (!existsSync(path)) {
          const tmp = `${path}.${randomUUID()}.tmp`;
          if (download.body instanceof Uint8Array) {
            const { writeFileSync } = await import("node:fs");
            writeFileSync(tmp, download.body);
          } else {
            const out = createWriteStream(tmp);
            const reader = download.body.getReader();
            try {
              for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                if (!out.write(Buffer.from(value))) await once(out, "drain");
              }
            } finally {
              reader.releaseLock();
            }
            await new Promise<void>((resolve, reject) => out.end((error?: Error | null) => (error ? reject(error) : resolve())));
          }
          renameSync(tmp, path);
        }
        const size = statSync(path).size;
        return {
          ...download,
          size,
          body: Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>,
        };
      } catch (error) {
        console.error("artifact cache failed", error);
        throw error;
      }
    },
  };
}
