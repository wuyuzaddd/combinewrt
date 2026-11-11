import { randomUUID } from "node:crypto";
import type { BuildPlan } from "../build/types";
import type { BuildStore } from "./store";
import type { ArtifactDownload, BuildAdapter, BuildRecord } from "./types";

const LOG_LIMIT = 20_000;

function tail(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  return text.length > LOG_LIMIT ? text.slice(-LOG_LIMIT) : text;
}

export interface BuildService {
  submit(plan: BuildPlan): Promise<BuildRecord>;
  list(limit?: number): BuildRecord[];
  refresh(id: string): Promise<BuildRecord | null>;
  refreshActive(limit?: number): Promise<BuildRecord[]>;
  listActive(limit?: number): BuildRecord[];
  artifact(id: string): Promise<ArtifactDownload | null>;
}

export function createBuildService(options: {
  store: BuildStore;
  adapter: BuildAdapter;
  now?: () => Date;
  pollIntervalMs?: number;
}): BuildService {
  const { store, adapter, now = () => new Date(), pollIntervalMs = 0 } = options;
  const inFlight = new Map<string, Promise<BuildRecord | null>>();
  const lastPoll = new Map<string, number>();

  function refresh(id: string): Promise<BuildRecord | null> {
    const record = store.get(id);
    if (!record) return Promise.resolve(null);
    if (record.status === "succeeded" || record.status === "failed") return Promise.resolve(record);

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
    if (record.status === "succeeded" || record.status === "failed") return record;
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
      const update = await adapter.getRun(record.runId);
      return store.update(
        id,
        {
          status: update.status,
          logTail: tail(update.logTail) ?? record.logTail,
          error: update.error ?? null,
          artifactName: update.artifactName ?? record.artifactName,
        },
        record.updatedAt,
      );
    } catch (error) {
      return store.update(id, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    async submit(plan) {
      const id = randomUUID();
      const timestamp = now().toISOString();
      store.create({
        id,
        plan,
        status: "queued",
        runId: null,
        adapter: adapter.name,
        logTail: "",
        error: null,
        artifactName: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      try {
        const { runId } = await adapter.dispatch(plan, { buildId: id, artifactName: plan.artifactName });
        if (!runId) return store.get(id) ?? {
          id,
          plan,
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

    list(limit) {
      return store.list(limit);
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

    async artifact(id) {
      const record = await refresh(id);
      if (!record || record.status !== "succeeded" || !record.runId || !record.artifactName) return null;
      return adapter.downloadArtifact(record.runId, record.artifactName);
    },
  };
}
