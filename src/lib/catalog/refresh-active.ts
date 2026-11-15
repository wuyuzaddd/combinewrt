import type { AppConfig } from "../config";
import type { DatabaseSync } from "node:sqlite";
import { createBaseVersionStore } from "../base/store";
import { createConfiguredImmortalWrtSource } from "./configured";
import { refreshCatalog, type RefreshResult } from "./service";
import { createCatalogStore } from "./store";
import { createImmortalWrtSource } from "./source";

export async function refreshActiveCatalog(input: {
  db: DatabaseSync;
  config: AppConfig;
}): Promise<RefreshResult> {
  const { db, config } = input;
  const baseVersion = createBaseVersionStore(db).active()?.version ?? config.baseVersion;
  const result = await refreshCatalog({
    source: createImmortalWrtSource(createConfiguredImmortalWrtSource(config, baseVersion)),
    db,
  });
  createCatalogStore(db).activateSnapshot(result.snapshot.id);
  return result;
}
