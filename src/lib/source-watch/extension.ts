import type { DatabaseSync } from "node:sqlite";
import type { SourceRegistry, SourceRegistryEntry } from "../sources/types";
import { recordObservedCandidate } from "./candidates";
import { sha256Hex } from "./observe";
import { patchSourceWatchState, readSourceWatchState } from "./store";
import type { RepoRefObservation } from "./types";

/**
 * Extension registry watch (ADR 0008, V2 review P1).
 *
 * The dllkids watch owns its feed index; extension entries are pinned git
 * commits in `config/sources/registry.json`. This watch observes the upstream
 * default-branch head of every extension entry and, when any of them moved,
 * records *one* candidate for the `extension` source: the pin is the sha256 of
 * the observed commit map and its cached bytes are that same JSON, so the
 * candidate is auditable and reproducible.
 *
 * It never adopts and never publishes: a candidate rebuild stays a signal for
 * the operator (the extension feed publish pipeline is separate).
 */
export interface ExtensionWatchEntry {
  name: string;
  repo: string;
  ref: string;
  subdir: string;
}

export interface ExtensionWatchResult {
  /** True when at least one registry ref moved. */
  changed: string[];
  /** The recorded candidate pin, null when nothing moved or the check failed. */
  candidatePin: string | null;
  error: string | null;
}

export interface ExtensionWatchOptions {
  db: DatabaseSync;
  cacheDir: string;
  entries: readonly ExtensionWatchEntry[];
  fetchImpl?: typeof fetch;
  now?: () => Date;
  token?: string | null;
}

/** The extension entries of the checked-in registry (themes and bundles too). */
export function extensionWatchEntries(registry: SourceRegistry): ExtensionWatchEntry[] {
  return registry
    .list()
    .filter((entry: SourceRegistryEntry) => entry.source === "extension")
    .map((entry) => ({
      name: entry.name,
      repo: entry.repo ?? "",
      ref: entry.ref ?? "",
      subdir: entry.subdir ?? ".",
    }))
    .filter((entry) => entry.repo !== "" && entry.ref !== "");
}

async function upstreamHead(
  entry: ExtensionWatchEntry,
  fetchImpl: typeof fetch,
  token: string | null | undefined,
): Promise<string | null> {
  const headers: Record<string, string> = { accept: "application/vnd.github+json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetchImpl(`https://api.github.com/repos/${entry.repo}/commits?per_page=1`, {
    headers,
  });
  if (!response.ok) throw new Error(`GET commits for ${entry.repo} failed: ${response.status}`);
  const commits = (await response.json()) as Array<{ sha?: string }>;
  const sha = commits[0]?.sha;
  return typeof sha === "string" && /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

export async function checkExtensionRefs(options: ExtensionWatchOptions): Promise<ExtensionWatchResult> {
  const { db, cacheDir, entries } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const nowIso = (options.now ?? (() => new Date()))().toISOString();
  const ref = "config/sources/registry.json#extension";

  const heads: Record<string, string> = {};
  const changed: string[] = [];
  try {
    for (const entry of entries) {
      const head = await upstreamHead(entry, fetchImpl, options.token);
      if (!head) throw new Error(`GitHub returned no commit for ${entry.repo}`);
      heads[entry.name] = head;
      if (head !== entry.ref) changed.push(entry.name);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordObservedCandidate({
      db,
      cacheDir,
      observation: {
        source: "extension",
        ref,
        observedAt: nowIso,
        pin: null,
        bytes: null,
        parsed: null,
        error: message,
      } satisfies RepoRefObservation<unknown>,
    });
    return { changed: [], candidatePin: null, error: message };
  }

  if (changed.length === 0) {
    patchSourceWatchState(
      db,
      "extension",
      { lastCheckAt: nowIso, lastSuccessAt: nowIso, lastError: null, candidateReason: "unchanged" },
      nowIso,
    );
    return { changed: [], candidatePin: null, error: null };
  }

  // One deterministic identity for the moved registry: sorted name -> upstream
  // head. The same moves always produce the same pin, so a repeated tick does
  // not create a new candidate.
  const bytes = Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(heads).sort())));
  const observation: RepoRefObservation<Record<string, string>> = {
    source: "extension",
    ref,
    observedAt: nowIso,
    pin: sha256Hex(bytes),
    bytes,
    parsed: heads,
    error: null,
  };
  const recorded = await recordObservedCandidate({
    db,
    cacheDir,
    observation,
    extension: ".json",
    metadata: { changed, heads },
  });
  return { changed, candidatePin: observation.pin, error: recorded.error };
}

/**
 * Interval gate for the extension watch. It shares `SOURCE_WATCH_INTERVAL_HOURS`
 * with the dllkids watch but keeps its own `source_watch_state` row.
 */
export async function runExtensionWatchIfDue(input: {
  db: DatabaseSync;
  cacheDir: string;
  entries: readonly ExtensionWatchEntry[];
  intervalMs: number;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  token?: string | null;
}): Promise<{ ran: boolean; result?: ExtensionWatchResult }> {
  const now = input.now ?? (() => new Date());
  const state = readSourceWatchState(input.db, "extension");
  if (state.lastCheckAt) {
    const elapsed = now().getTime() - Date.parse(state.lastCheckAt);
    if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < input.intervalMs) return { ran: false };
  }
  const result = await checkExtensionRefs({
    db: input.db,
    cacheDir: input.cacheDir,
    entries: input.entries,
    fetchImpl: input.fetchImpl,
    now,
    token: input.token,
  });
  return { ran: true, result };
}
