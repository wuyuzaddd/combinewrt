import type { DatabaseSync } from "node:sqlite";
import { dedupePackages, parseAdbDump } from "./packages";
import { parseProfiles } from "./profiles";
import { createCatalogStore } from "./store";
import type { PackageSource, SnapshotMeta, SourcePins } from "./types";
import { EMPTY_SOURCE_PINS } from "./types";

export interface CatalogDump {
  feed: string;
  dump: string;
  source?: PackageSource;
  sourcePin?: string;
  downloadBase?: string | null;
}

export interface CatalogSource {
  baseVersion: string;
  loadMeta(): Promise<{ profilesJson: unknown; feedCommit: string; sourceNote: string; sourcePins?: SourcePins }>;
  loadDumps(): Promise<CatalogDump[]>;
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
  const packages = dedupePackages(
    dumps.flatMap(({ feed, dump, source: packageSource, sourcePin, downloadBase }) =>
      parseAdbDump(dump, feed, {
        source: packageSource ?? "official",
        sourcePin: sourcePin ?? "",
        downloadBase: downloadBase ?? null,
      }),
    ),
  );
  if (packages.length === 0) {
    throw new Error("feed dumps contained no packages");
  }

  const snapshot = store.saveSnapshot({
    baseVersion: source.baseVersion,
    feedCommit: meta.feedCommit,
    sourceNote: meta.sourceNote,
    sourcePins: meta.sourcePins ?? EMPTY_SOURCE_PINS,
    profiles,
    packages,
  });
  return { snapshot, created: true };
}
