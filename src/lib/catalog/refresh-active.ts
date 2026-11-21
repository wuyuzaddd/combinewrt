import type { AppConfig } from "../config";
import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { createBaseVersionStore } from "../base/store";
import { readSourcePin } from "../source-watch/store";
import { createConfiguredImmortalWrtSource, type ConfiguredSourceConfig } from "./configured";
import { refreshCatalog, type RefreshResult } from "./service";
import { createCatalogStore } from "./store";
import { createImmortalWrtSource } from "./source";

/**
 * Where the effective dllkids pin came from.
 *
 * `snapshot` is the normal case for a plan: the catalog snapshot it resolved
 * already recorded the pin it was built from. `database`/`config-seed` are the
 * fallback for a snapshot that predates dllkids pin capture.
 */
export type DllkidsPinSource = "snapshot" | "database" | "config-seed";

export interface ResolvedDllkidsPin {
  value: string;
  source: DllkidsPinSource;
}

/**
 * The dllkids pin a new plan or catalog refresh must use, together with its
 * authority.
 *
 * ADR 0009 ruling 1: the `source_pins` row is authoritative. The configured
 * value (`DLLKIDS_INDEX_SHA256_SEED` / legacy `DLLKIDS_INDEX_SHA256`, whose
 * default lives in `feeds.ts`) is only the first-install seed; when the
 * database has no adopted pin yet the value is returned but named
 * `config-seed`, so plans and source offers can mark it.
 */
export function resolveActiveDllkidsPin(
  db: Pick<DatabaseSync, "prepare">,
  config: Pick<AppConfig, "dllkidsIndexSha256">,
): ResolvedDllkidsPin {
  const adopted = readSourcePin(db as DatabaseSync, "dllkids", "active");
  if (adopted) return { value: adopted.value, source: "database" };
  return { value: config.dllkidsIndexSha256, source: "config-seed" };
}

/**
 * Resolve the dllkids pin for a plan that is being composed from an already
 * resolved catalog snapshot.
 *
 * ADR 0009 ruling 1 makes the pin list authoritative *per snapshot*: the
 * snapshot was itself created from an adopted pin, and its package entries
 * carry that pin. The DB active pin governs future refreshes, so it must not
 * overwrite a snapshot that already has a dllkids pin. Only a snapshot with no
 * pin falls back to the live DB pin / configured seed.
 */
export function resolvePlanDllkidsPin(
  db: Pick<DatabaseSync, "prepare">,
  config: Pick<AppConfig, "dllkidsIndexSha256">,
  snapshotPin: string | null,
): ResolvedDllkidsPin {
  if (snapshotPin) return { value: snapshotPin, source: "snapshot" };
  return resolveActiveDllkidsPin(db, config);
}

/**
 * The dllkids pin the next catalog refresh must use.
 *
 * Ticket 10 moved the active pin into the `source_pins` table; the config
 * constant (`DLLKIDS_INDEX_SHA256_SEED`) is only a seed for a fresh installation.
 * Reading the config value first made a DB-adopted pin invisible to the manual
 * "refresh catalog" action, which then failed with a checksum mismatch.
 */
export function activeDllkidsPin(
  db: Pick<DatabaseSync, "prepare">,
  config: Pick<AppConfig, "dllkidsIndexSha256">,
): string {
  return resolveActiveDllkidsPin(db, config).value;
}

export function activeSourceConfig(
  db: Pick<DatabaseSync, "prepare">,
  config: ConfiguredSourceConfig,
): ConfiguredSourceConfig {
  return { ...config, dllkidsIndexSha256: activeDllkidsPin(db, config) };
}

/**
 * The adopted dllkids index bytes the source watch already cached, when they
 * still hash to the active pin.
 *
 * A catalog refresh re-downloading a 100 KB index from a throttled feed on
 * every run is what made "refresh catalog" fail on flaky links while the pin
 * was already adopted and verified. The cached bytes are the same bytes the
 * pin was adopted from, and the sha is re-checked by the source loader, so the
 * refresh keeps its integrity guarantee; live re-observation stays the source
 * watch's job.
 */
export function cachedDllkidsIndex(
  db: Pick<DatabaseSync, "prepare">,
): Uint8Array | null {
  const pin = readSourcePin(db as DatabaseSync, "dllkids", "active");
  if (!pin || !pin.cachePath || pin.cacheSha256 !== pin.value) return null;
  try {
    return new Uint8Array(readFileSync(pin.cachePath));
  } catch {
    return null;
  }
}

export async function refreshActiveCatalog(input: {
  db: DatabaseSync;
  config: AppConfig;
}): Promise<RefreshResult> {
  const { db, config } = input;
  const baseVersion = createBaseVersionStore(db).active()?.version ?? config.baseVersion;
  const cached = cachedDllkidsIndex(db);
  const result = await refreshCatalog({
    source: createImmortalWrtSource(
      createConfiguredImmortalWrtSource(activeSourceConfig(db, config), baseVersion, {
        ...(cached ? { dllkidsIndexBytes: cached } : {}),
      }),
    ),
    db,
  });
  createCatalogStore(db).activateSnapshot(result.snapshot.id);
  return result;
}
