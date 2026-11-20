import { createBaseVersionStore } from "../base/store";
import { createConfiguredImmortalWrtSource } from "../catalog/configured";
import { activeSourceConfig } from "../catalog/refresh-active";
import { refreshCatalog } from "../catalog/service";
import { createImmortalWrtSource } from "../catalog/source";
import { createCatalogStore } from "../catalog/store";
import { getConfig } from "../config";
import { getDatabase } from "../db";
import { loadSourceRegistry } from "../sources/registry";
import { readSourcePin } from "../source-watch/store";
import {
  createFeedRecordFetcher,
  createGitHubPublishDispatcher,
  createGitHubRunReader,
  createGitHubSupplementDispatcher,
  createGitHubUpstreamObserver,
} from "./github";
import { buildSupplementRecipe } from "./recipe-source";
import { createSupplementWatchService, type SupplementWatchService } from "./service";

let cached: SupplementWatchService | undefined;
let timer: NodeJS.Timeout | undefined;

const TICK_MS = 5 * 60 * 1000;

/**
 * Rebuild the catalog after a live auto-publish so the source offer and the
 * catalogue's supplement pin point at the just-published index while the old
 * index stays downloadable at its frozen path.
 */
function createRefresh(db: ReturnType<typeof getDatabase>, config: ReturnType<typeof getConfig>) {
  return async (input: { commit: string; baseVersion: string }) => {
    const baseVersion = createBaseVersionStore(db).active()?.version ?? input.baseVersion;
    const sourceOptions = createConfiguredImmortalWrtSource(activeSourceConfig(db, config), baseVersion);
    const pin = readSourcePin(db, "supplement", "active");
    if (pin) {
      sourceOptions.supplement = { commit: pin.value, fingerprint: config.supplementKeyFingerprint };
    }
    const result = await refreshCatalog({
      source: createImmortalWrtSource(sourceOptions),
      db,
    });
    const activated = createCatalogStore(db).activateSnapshot(result.snapshot.id);
    if (!activated) throw new Error(`catalog snapshot ${result.snapshot.id} could not be activated`);
    return { snapshotId: result.snapshot.id };
  };
}

/**
 * Lazily-created supplement watch. It shares the app's database and config and
 * is started from the same place as the dllkids watch.
 */
export function getSupplementWatchService(): SupplementWatchService {
  if (cached) return cached;
  const config = getConfig();
  const db = getDatabase();
  const recipe = buildSupplementRecipe({
    registry: loadSourceRegistry(),
    sourceRepo: config.supplementSourceRepo,
    ref: config.supplementSourceRef,
    baseVersion: config.baseVersion,
    target: config.supplementTarget,
  });

  cached = createSupplementWatchService({
    db,
    sourceRepo: config.supplementSourceRepo,
    sourceRef: config.supplementSourceRef,
    baseVersion: config.baseVersion,
    target: config.supplementTarget,
    buildRepo: config.buildRepo,
    buildWorkflow: config.supplementWorkflow,
    keyFingerprint: config.supplementKeyFingerprint,
    publishAuditUrl: config.supplementPublishAuditUrl,
    stagingAuditUrl: config.supplementStagingAuditUrl,
    intervalMs: config.sourceWatchIntervalHours * 60 * 60 * 1000,
    readRecipe: () => recipe,
    observeUpstream: createGitHubUpstreamObserver({
      repo: config.supplementSourceRepo,
      ref: config.supplementSourceRef,
      token: config.buildRepoToken,
    }),
    dispatchBuild: createGitHubSupplementDispatcher({
      repo: config.buildRepo,
      workflow: config.supplementWorkflow,
      token: config.buildRepoToken,
      dispatchRef: config.buildRef,
    }),
    readRun: createGitHubRunReader({ repo: config.buildRepo, token: config.buildRepoToken }),
    dispatchPublish: createGitHubPublishDispatcher({
      repo: "wuyuzaddd/combinewrt-packages",
      token: config.buildRepoToken,
    }),
    fetchFeedRecord: createFeedRecordFetcher({}),
    refresh: createRefresh(db, config),
  });
  return cached;
}

/**
 * Five-minute tick: dispatch at most one build every `sourceWatchIntervalHours`
 * (runIfDue), then reconcile whichever dispatch is still unresolved. Webhook
 * triggers go through the identical candidate path, so a webhook and a tick
 * cannot both dispatch for the same upstream commit.
 */
export function startSupplementWatch(): void {
  if (timer) return;
  const config = getConfig();
  if (!config.supplementWatchEnabled) return;
  if (config.buildAdapter !== "github") return;
  const service = getSupplementWatchService();
  const tick = () => {
    void service
      .runIfDue()
      .then((outcome) => {
        if (outcome.result?.error) {
          console.error(`[combinewrt] supplement watch failed: ${outcome.result.error}`);
        }
        return service.reconcile();
      })
      .catch((error: unknown) => {
        console.error(
          `[combinewrt] supplement reconcile failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  };
  const first = setTimeout(tick, 90_000);
  first.unref();
  timer = setInterval(tick, TICK_MS);
  timer.unref();
}
