import type { DatabaseSync } from "node:sqlite";
import { dedupePackages, parseAdbDump } from "./packages";
import { parseProfiles } from "./profiles";
import { createCatalogStore } from "./store";
import type { SnapshotMeta } from "./types";

export interface CatalogSource {
  baseVersion: string;
  loadMeta(): Promise<{ profilesJson: unknown; feedCommit: string; sourceNote: string }>;
  loadDumps(): Promise<Array<{ feed: string; dump: string }>>;
}

export interface RefreshResult {
  snapshot: SnapshotMeta;
  created: boolean;
}

export async function refreshCatalog({ source, db }: { source: CatalogSource; db: DatabaseSync }): Promise<RefreshResult> {
  const meta = await source.loadMeta();
  const profiles = parseProfiles(meta.profilesJson);
  const store = createCatalogStore(db);

  const existing = store.findSnapshot(source.baseVersion, meta.feedCommit);
  if (existing) {
    return { snapshot: existing, created: false };
  }

  const dumps = await source.loadDumps();
  const packages = dedupePackages(dumps.flatMap(({ feed, dump }) => parseAdbDump(dump, feed)));
  if (packages.length === 0) {
    throw new Error("feed dumps contained no packages");
  }

  const snapshot = store.saveSnapshot({
    baseVersion: source.baseVersion,
    feedCommit: meta.feedCommit,
    sourceNote: meta.sourceNote,
    profiles,
    packages,
  });
  return { snapshot, created: true };
}
