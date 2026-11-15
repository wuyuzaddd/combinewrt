import type { DatabaseSync } from "node:sqlite";
import { writeCachedIndex } from "./cache";
import { patchSourceWatchState, readSourcePin, upsertSourcePin } from "./store";
import type { RepoRefObservation, SourcePinRecord } from "./types";

export interface RecordCandidateResult {
  record: SourcePinRecord | null;
  error: string | null;
}

/**
 * Reusable candidate recorder for source watches (tickets 11/12). It caches
 * the observed index bytes under the pin and stores the candidate row, but it
 * does not adopt: adoption policy stays with the owning watch service.
 *
 * The caller observes first (`observeRepoRef`) and passes the observation here.
 */
export async function recordObservedCandidate<T>(input: {
  db: DatabaseSync;
  cacheDir: string;
  observation: RepoRefObservation<T>;
  extension?: string;
  metadata?: Record<string, unknown>;
}): Promise<RecordCandidateResult> {
  const { db, cacheDir, observation } = input;
  const source = observation.source;
  const observedAt = observation.observedAt;

  if (observation.error || !observation.pin) {
    const failure = observation.error ?? "源 ref 观察结果没有 pin";
    patchSourceWatchState(
      db,
      source,
      { lastCheckAt: observedAt, lastError: failure, candidateReason: null },
      observedAt,
    );
    return { record: null, error: failure };
  }

  let cachePath: string | null = null;
  let cacheSha256: string | null = null;
  if (observation.bytes) {
    const cached = await writeCachedIndex({
      cacheDir,
      source,
      pin: observation.pin,
      bytes: observation.bytes,
      extension: input.extension ?? ".adb",
    });
    cachePath = cached.path;
    cacheSha256 = cached.sha256;
  }

  upsertSourcePin(db, {
    source,
    status: "candidate",
    value: observation.pin,
    observedAt,
    cachePath,
    cacheSha256,
    metadata: {
      ref: observation.ref,
      ...input.metadata,
    },
  });

  patchSourceWatchState(
    db,
    source,
    { lastCheckAt: observedAt, lastSuccessAt: observedAt, lastError: null },
    observedAt,
  );

  return { record: readSourcePin(db, source, "candidate"), error: null };
}
