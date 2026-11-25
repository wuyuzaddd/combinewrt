import { getConfig } from "../config";
import { getDatabase } from "../db";
import { createAdapter } from "./adapter";
import { createArtifactCache, reconcileArtifactCache } from "./artifact-cache";
import { createArtifactCacheStore } from "./artifact-store";
import { createBuildService, type BuildService } from "./service";
export type { ArtifactFileInfo } from "./service";
import { createBuildStore } from "./store";

import { createReconciler, type Reconciler } from "./reconciler";
import { createBuildRetryService, type BuildRetryService } from "./retry";
import { sealJson } from "../crypto/seal";
import {
  pruneArtifactCache,
  pruneArtifactCacheBySize,
  recordRetention,
} from "./retention";

let cached: BuildService | undefined;
let reconciler: Reconciler | undefined;
let retryQueue: BuildRetryService | undefined;

/** Persist the sealed submission body so the retry queue can rebuild it. */
export function recordSubmitBody(buildId: string, body: unknown): void {
  try {
    createBuildStore(getDatabase()).setSubmitBody(buildId, sealJson(body));
  } catch (error) {
    console.error("[combinewrt] could not seal the submission for retries", error);
  }
}

function artifactCache() {
  const config = getConfig();
  return createArtifactCache({
    dir: config.artifactCacheDir,
    store: createArtifactCacheStore(getDatabase()),
    limitBytes: config.artifactMaxBytes,
  });
}

export function getBuildService(): BuildService {
  cached ??= createBuildService({
    store: createBuildStore(getDatabase()),
    adapter: createAdapter(getConfig()),
    maxConcurrentBuilds: getConfig().maxConcurrentBuilds,
    sessionSecret: getConfig().sessionSecret,
    pollIntervalMs: 5_000,
    cacheDir: getConfig().artifactCacheDir,
    artifactMaxBytes: getConfig().artifactMaxBytes,
    cache: artifactCache(),
  });
  return cached;
}

let retentionTimer: NodeJS.Timeout | undefined;

export function startRetention(): void {
  if (retentionTimer) return;
  const run = () => {
    try {
      const config = getConfig();
      const store = createArtifactCacheStore(getDatabase());
      const cache = createArtifactCache({
        dir: config.artifactCacheDir,
        store,
        limitBytes: config.artifactMaxBytes,
      });
      // Age first (the retention promise), then the size ceiling; both keep
      // build records and manifests, they only evict cached files.
      const byAge = pruneArtifactCache(config.artifactCacheDir, config.artifactRetentionDays);
      const bySize = pruneArtifactCacheBySize(config.artifactCacheDir, config.artifactCacheMaxBytes);
      const reconcile = reconcileArtifactCache({ dir: config.artifactCacheDir, store });
      const stats = cache.stats();
      recordRetention(getDatabase(), {
        at: new Date().toISOString(),
        removed: byAge.removed + bySize.removed,
        removedBytes: byAge.removedBytes + bySize.removedBytes,
        remainingBytes: stats.bytes,
        entries: stats.entries,
        failed: byAge.failed,
      });
      if (reconcile.dropped > 0 || reconcile.adopted > 0 || reconcile.stagingRemoved > 0) {
        console.info(
          "[combinewrt] artifact cache reconciled",
          `dropped=${reconcile.dropped}`,
          `adopted=${reconcile.adopted}`,
          `stagingRemoved=${reconcile.stagingRemoved}`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[combinewrt] artifact retention failed", error);
      try {
        recordRetention(getDatabase(), {
          at: new Date().toISOString(),
          removed: 0,
          failed: [],
          error: message,
        });
      } catch {
        // the database may be unavailable during boot
      }
    }
  };
  const first = setTimeout(run, 5_000);
  first.unref();
  retentionTimer = setInterval(run, 24 * 60 * 60 * 1000);
  retentionTimer.unref();
}

export function startReconciler(): void {
  if (reconciler) return;
  retryQueue = createBuildRetryService({ db: getDatabase() });
  reconciler = createReconciler(getBuildService(), { retry: retryQueue });
  reconciler.start();
}
