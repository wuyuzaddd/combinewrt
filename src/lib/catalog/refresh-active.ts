import type { AppConfig } from "../config";
import type { DatabaseSync } from "node:sqlite";
import { createBaseVersionStore } from "../base/store";
import { readSourcePin } from "../source-watch/store";
import { createConfiguredImmortalWrtSource, type ConfiguredSourceConfig } from "./configured";
import { refreshCatalog, type RefreshResult } from "./service";
import { createCatalogStore } from "./store";
import { createImmortalWrtSource } from "./source";

/**
 * The dllkids pin the next catalog refresh must use.
 *
 * Ticket 10 moved the active pin into the `source_pins` table; the config
 * constant (`DLLKIDS_INDEX_SHA256`) is only a seed for a fresh installation.
 * Reading the config value first made a DB-adopted pin invisible to the manual
 * "refresh catalog" action, which then failed with a checksum mismatch.
 */
export function activeDllkidsPin(
  db: Pick<DatabaseSync, "prepare">,
  config: Pick<AppConfig, "dllkidsIndexSha256">,
): string {
  return readSourcePin(db as DatabaseSync, "dllkids", "active")?.value ?? config.dllkidsIndexSha256;
}

export function activeSourceConfig(
  db: Pick<DatabaseSync, "prepare">,
  config: ConfiguredSourceConfig,
): ConfiguredSourceConfig {
  return { ...config, dllkidsIndexSha256: activeDllkidsPin(db, config) };
}

export async function refreshActiveCatalog(input: {
  db: DatabaseSync;
  config: AppConfig;
}): Promise<RefreshResult> {
  const { db, config } = input;
  const baseVersion = createBaseVersionStore(db).active()?.version ?? config.baseVersion;
  const result = await refreshCatalog({
    source: createImmortalWrtSource(createConfiguredImmortalWrtSource(activeSourceConfig(db, config), baseVersion)),
    db,
  });
  createCatalogStore(db).activateSnapshot(result.snapshot.id);
  return result;
}
