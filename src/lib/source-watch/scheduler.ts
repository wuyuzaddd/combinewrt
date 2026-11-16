import { createBaseVersionStore } from "../base/store";
import { createConfiguredImmortalWrtSource } from "../catalog/configured";
import { refreshCatalog } from "../catalog/service";
import { createImmortalWrtSource } from "../catalog/source";
import { createCatalogStore } from "../catalog/store";
import { getConfig } from "../config";
import { getDatabase } from "../db";
import { createDllkidsRepoRefWatcher } from "./dllkids";
import { extensionWatchEntries, runExtensionWatchIfDue } from "./extension";
import { loadSourceRegistry } from "../sources/registry";
import { createSourceWatchService, type SourceWatchService } from "./service";
import type { SourcePinRefreshInput } from "./types";

let cached: SourceWatchService | undefined;
let timer: NodeJS.Timeout | undefined;

const TICK_MS = 60 * 60 * 1000;

function createRefresh(
  db: ReturnType<typeof getDatabase>,
  config: ReturnType<typeof getConfig>,
) {
  return async (input: SourcePinRefreshInput) => {
    const baseVersion = createBaseVersionStore(db).active()?.version ?? config.baseVersion;
    const sourceOptions = createConfiguredImmortalWrtSource(config, baseVersion);
    if (!sourceOptions.dllkids) throw new Error("dllkids feed is not configured");
    // Use the adopted pin and its cached bytes instead of the config pin. The
    // catalog snapshot's sourcePins then records exactly what this build uses.
    sourceOptions.dllkids = {
      ...sourceOptions.dllkids,
      indexSha256: input.pin,
      indexBytes: input.indexBytes,
    };
    const result = await refreshCatalog({
      source: createImmortalWrtSource(sourceOptions),
      db,
    });
    const activated = createCatalogStore(db).activateSnapshot(result.snapshot.id);
    if (!activated) {
      throw new Error(`catalog snapshot ${result.snapshot.id} could not be activated`);
    }
    return { snapshotId: result.snapshot.id };
  };
}

export function getSourceWatchService(): SourceWatchService {
  if (cached) return cached;
  const config = getConfig();
  const db = getDatabase();
  cached = createSourceWatchService({
    db,
    cacheDir: config.sourceCacheDir,
    intervalMs: config.sourceWatchIntervalHours * 60 * 60 * 1000,
    watcher: createDllkidsRepoRefWatcher({
      baseUrl: config.dllkidsFeedUrl,
      apkBin: config.apkBin,
    }),
    seedPin: config.dllkidsIndexSha256,
    refresh: createRefresh(db, config),
  });
  return cached;
}

/**
 * The app has no job runner; like catalog refresh and the reconciler, the
 * source watch runs lazily inside the Next.js server process. A one-hour tick
 * calls runIfDue, which enforces the configured six-hour interval.
 */
export function startSourceWatch(): void {
  if (timer) return;
  const service = getSourceWatchService();
  const config = getConfig();
  const db = getDatabase();
  const entries = extensionWatchEntries(loadSourceRegistry());
  const tick = () => {
    void service.runIfDue().then((outcome) => {
      if (outcome.result?.error) {
        console.error(`[combinewrt] source watch failed: ${outcome.result.error}`);
      }
    });
    // ADR 0008: extension registry refs are watched by the same scheduler. A
    // moved ref only records a candidate rebuild; nothing is adopted or
    // published here.
    if (entries.length > 0) {
      void runExtensionWatchIfDue({
        db,
        cacheDir: config.sourceCacheDir,
        entries,
        intervalMs: config.sourceWatchIntervalHours * 60 * 60 * 1000,
        token: config.buildRepoToken,
      }).catch((error: unknown) => {
        console.error(
          `[combinewrt] extension watch failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }
  };
  const first = setTimeout(tick, 45_000);
  first.unref();
  timer = setInterval(tick, TICK_MS);
  timer.unref();
}
