import { getConfig } from "../config";
import { getDatabase } from "../db";
import { refreshActiveCatalog } from "./refresh-active";
import { createCatalogRefreshRunner, type CatalogRefreshRunner } from "./refresh-control";

let cached: CatalogRefreshRunner | undefined;
let timer: NodeJS.Timeout | undefined;

export function getCatalogRefreshRunner(): CatalogRefreshRunner {
  cached ??= createCatalogRefreshRunner({
    db: getDatabase(),
    refresh: () => refreshActiveCatalog({ db: getDatabase(), config: getConfig() }),
  });
  return cached;
}

const TICK_MS = 60 * 60 * 1000;

export function startCatalogRefresh(): void {
  if (timer) return;
  const runner = getCatalogRefreshRunner();
  const tick = () => {
    void runner.runIfDue().then((outcome) => {
      if (outcome.error) console.error(`[combinewrt] catalog refresh failed: ${outcome.error}`);
    });
  };
  const first = setTimeout(tick, 20_000);
  first.unref();
  timer = setInterval(tick, TICK_MS);
  timer.unref();
}
