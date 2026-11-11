import { getConfig } from "../config";
import { getDatabase } from "../db";
import { createAdapter } from "./adapter";
import { createBuildService, type BuildService } from "./service";
import { createBuildStore } from "./store";

import { createReconciler, type Reconciler } from "./reconciler";
import { pruneArtifactCache } from "./retention";

let cached: BuildService | undefined;
let reconciler: Reconciler | undefined;

export function getBuildService(): BuildService {
  cached ??= createBuildService({
    store: createBuildStore(getDatabase()),
    adapter: createAdapter(getConfig()),
    pollIntervalMs: 5_000,
    cacheDir: getConfig().artifactCacheDir,
  });
  return cached;
}

let retentionTimer: NodeJS.Timeout | undefined;

export function startRetention(): void {
  if (retentionTimer) return;
  const run = () => {
    try {
      const config = getConfig();
      const result = pruneArtifactCache(config.artifactCacheDir, config.artifactRetentionDays);
      const db = getDatabase();
      const value = JSON.stringify({ at: new Date().toISOString(), ...result });
      db.prepare(
        "INSERT INTO app_meta (key, value) VALUES ('retention.last', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      ).run(value);
    } catch (error) {
      console.error("[combinewrt] artifact retention failed", error);
    }
  };
  run();
  retentionTimer = setInterval(run, 24 * 60 * 60 * 1000);
  retentionTimer.unref();
}

export function startReconciler(): void {
  if (reconciler) return;
  reconciler = createReconciler(getBuildService());
  reconciler.start();
}
