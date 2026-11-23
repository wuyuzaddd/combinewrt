import { createHash } from "node:crypto";
import type { RepoRefObservation, RepoRefWatcher, WatchSourceId } from "./types";

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface HttpRepoRefWatcherOptions<T> {
  source: WatchSourceId;
  ref: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  /** Full parse of the downloaded bytes. Throwing rejects the observation. */
  parse: (bytes: Buffer) => T | Promise<T>;
  /**
   * Derive the immutable pin from the downloaded bytes. Defaults to their
   * sha256; repository-based sources can override this with a commit id.
   */
  identify?: (bytes: Buffer) => string | Promise<string>;
}

/**
 * Observe an HTTP-served source ref with injectable network and clock seams.
 * The watcher never throws: upstream failures and partial parses become an
 * error observation so the previous pin stays usable.
 */
export function createHttpRepoRefWatcher<T>(
  options: HttpRepoRefWatcherOptions<T>,
): RepoRefWatcher<T> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const identify = options.identify ?? ((bytes: Buffer) => sha256Hex(bytes));

  let inFlight: Promise<RepoRefObservation<T>> | null = null;

  // A hanging upstream must not freeze the watch queue: every request gets a
  // hard deadline and one retry, and 4xx answers are not retried.
  const FETCH_TIMEOUT_MS = 90_000;

  async function fetchIndex(): Promise<Response> {
    let lastError: unknown = new Error(`GET ${options.ref} failed`);
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const response = await fetchImpl(options.ref, {
          headers: { accept: "application/octet-stream" },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (response.ok || response.status < 500) return response;
        lastError = new Error(`GET ${options.ref} failed: ${response.status}`);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  async function observeOnce(): Promise<RepoRefObservation<T>> {
    const observedAt = (options.now ?? (() => new Date()))().toISOString();
    const base: RepoRefObservation<T> = {
      source: options.source,
      ref: options.ref,
      observedAt,
      pin: null,
      bytes: null,
      parsed: null,
      error: null,
    };

    try {
      const response = await fetchIndex();
      if (!response.ok) {
        throw new Error(`GET ${options.ref} failed: ${response.status}`);
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      const pin = await identify(bytes);
      const parsed = await options.parse(bytes);
      return { ...base, pin, bytes, parsed };
    } catch (error) {
      return { ...base, error: error instanceof Error ? error.message : String(error) };
    }
  }

  return {
    source: options.source,
    ref: options.ref,
    parse: async (bytes) => options.parse(bytes),
    observe() {
      // Collapse concurrent observers (scheduler tick + admin "check now").
      if (!inFlight) {
        inFlight = observeOnce().finally(() => {
          inFlight = null;
        });
      }
      return inFlight;
    },
  };
}

/**
 * Observe one repository ref through any watcher. This is the entry point the
 * supplement (ticket 11) and extension (ticket 12) watches use before they
 * record a candidate pin.
 */
export async function observeRepoRef<T>(
  watcher: RepoRefWatcher<T>,
): Promise<RepoRefObservation<T>> {
  try {
    return await watcher.observe();
  } catch (error) {
    return {
      source: watcher.source,
      ref: watcher.ref,
      observedAt: new Date().toISOString(),
      pin: null,
      bytes: null,
      parsed: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
