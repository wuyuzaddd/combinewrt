import type { BuildRunState } from "./service";

/**
 * GitHub REST helpers for the supplement watch. Everything takes an injected
 * fetch so the dispatch/reconcile paths can be tested without network access,
 * and every helper throws a short, secret-free error message on failure.
 */
const API = "https://api.github.com";

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function failureOf(response: Response, what: string): Promise<Error> {
  let detail = "";
  try {
    detail = (await response.text()).slice(0, 300);
  } catch {
    detail = "";
  }
  return new Error(`${what} failed: ${response.status} ${detail}`.trim());
}

export interface UpstreamOptions {
  repo: string;
  ref: string;
  token: string;
  fetchImpl?: typeof fetch;
}

export interface UpstreamObservation {
  commit: string;
  observedAt: string;
}

/** HEAD commit of the upstream branch that supplement packages are built from. */
export function createGitHubUpstreamObserver(options: UpstreamOptions) {
  const { repo, ref, token, fetchImpl = fetch } = options;
  return async (): Promise<UpstreamObservation> => {
    const response = await fetchImpl(`${API}/repos/${repo}/commits/${encodeURIComponent(ref)}`, {
      headers: headers(token),
    });
    if (!response.ok) throw await failureOf(response, `reading ${repo}@${ref}`);
    const body = (await response.json()) as {
      sha?: unknown;
      commit?: { committer?: { date?: unknown } };
    };
    if (typeof body.sha !== "string" || !/^[0-9a-f]{40}$/.test(body.sha)) {
      throw new Error(`reading ${repo}@${ref} returned no commit sha`);
    }
    const observedAt =
      typeof body.commit?.committer?.date === "string"
        ? body.commit.committer.date
        : new Date().toISOString();
    return { commit: body.sha, observedAt };
  };
}

export interface SupplementDispatchOptions {
  repo: string;
  workflow: string;
  token: string;
  fetchImpl?: typeof fetch;
  /** Branch or tag the workflow runs on; defaults to the repository default branch. */
  dispatchRef?: string;
  /** Extra seconds to wait for the dispatched run to appear. */
  runLookupAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface SupplementDispatchInput {
  baseVersion: string;
  sourceCommit: string;
  publishMode: "live" | "staging";
  gateReason: string;
}

/**
 * Dispatch the supplement build with an explicit source commit and publish mode
 * and resolve the run id GitHub created for it.
 */
export function createGitHubSupplementDispatcher(options: SupplementDispatchOptions) {
  const {
    repo,
    workflow,
    token,
    dispatchRef,
    fetchImpl = fetch,
    runLookupAttempts = 20,
    sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = options;

  return async (input: SupplementDispatchInput): Promise<{ runId: string; url: string | null }> => {
    const after = new Date();
    const response = await fetchImpl(`${API}/repos/${repo}/actions/workflows/${workflow}/dispatches`, {
      method: "POST",
      headers: { ...headers(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        ref: dispatchRef,
        inputs: {
          base_version: input.baseVersion,
          source_commit: input.sourceCommit,
          publish_mode: input.publishMode,
          gate_reason: input.gateReason,
        },
      }),
    });
    if (!response.ok) throw await failureOf(response, `dispatching ${workflow}`);

    for (let attempt = 0; attempt < runLookupAttempts; attempt += 1) {
      const run = await findDispatchedRun({ repo, workflow, token, fetchImpl, after });
      if (run) return { runId: String(run.id), url: run.htmlUrl };
      await sleep(2_000);
    }
    // The workflow ran but the run id is not resolvable yet: the caller keeps a
    // row without a run id and reconcile reports it as missing.
    return { runId: "", url: null };
  };
}

interface RunSummary {
  id: number;
  createdAt: string;
  htmlUrl: string | null;
}

async function listRuns(options: {
  repo: string;
  workflow: string;
  token: string;
  fetchImpl: typeof fetch;
  limit?: number;
}): Promise<RunSummary[]> {
  const { repo, workflow, token, fetchImpl, limit = 20 } = options;
  const response = await fetchImpl(
    `${API}/repos/${repo}/actions/workflows/${workflow}/runs?per_page=${limit}&event=workflow_dispatch`,
    { headers: headers(token) },
  );
  if (!response.ok) throw await failureOf(response, "listing workflow runs");
  const body = (await response.json()) as {
    workflow_runs?: Array<{ id?: unknown; created_at?: unknown; html_url?: unknown }>;
  };
  return (body.workflow_runs ?? []).flatMap((run) => {
    if (typeof run.id !== "number" || typeof run.created_at !== "string") return [];
    return [
      {
        id: run.id,
        createdAt: run.created_at,
        htmlUrl: typeof run.html_url === "string" ? run.html_url : null,
      },
    ];
  });
}

async function findDispatchedRun(options: {
  repo: string;
  workflow: string;
  token: string;
  fetchImpl: typeof fetch;
  after: Date;
}): Promise<RunSummary | null> {
  const runs = await listRuns(options);
  const cutoff = options.after.getTime() - 5_000;
  const recent = runs
    .filter((run) => Date.parse(run.createdAt) >= cutoff)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  return recent[0] ?? null;
}

export interface RunReaderOptions {
  repo: string;
  token: string;
  fetchImpl?: typeof fetch;
}

/** Read one workflow run's status/conclusion. */
export function createGitHubRunReader(options: RunReaderOptions) {
  const { repo, token, fetchImpl = fetch } = options;
  return async (runId: string): Promise<BuildRunState> => {
    const response = await fetchImpl(`${API}/repos/${repo}/actions/runs/${encodeURIComponent(runId)}`, {
      headers: headers(token),
    });
    if (!response.ok) throw await failureOf(response, `reading run ${runId}`);
    const body = (await response.json()) as {
      status?: unknown;
      conclusion?: unknown;
      html_url?: unknown;
    };
    const status = typeof body.status === "string" ? body.status : "unknown";
    return {
      status:
        status === "completed"
          ? "completed"
          : status === "queued" || status === "in_progress"
            ? status
            : "unknown",
      conclusion: typeof body.conclusion === "string" ? body.conclusion : null,
      url: typeof body.html_url === "string" ? body.html_url : null,
    };
  };
}

export interface PublishDispatchOptions {
  repo: string;
  token: string;
  eventType?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Ask the feed repo to publish a build run. Promotion uses the same event with
 * `publish_mode: "live"`, which is why the staging and live paths share one
 * dispatch function.
 */
export function createGitHubPublishDispatcher(options: PublishDispatchOptions) {
  const { repo, token, eventType = "supplement-publish", fetchImpl = fetch } = options;
  return async (input: {
    buildRunId: string;
    baseVersion: string;
    sourceCommit: string;
    publishMode?: "live" | "staging";
  }): Promise<void> => {
    const response = await fetchImpl(`${API}/repos/${repo}/dispatches`, {
      method: "POST",
      headers: { ...headers(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        event_type: eventType,
        client_payload: {
          build_run_id: input.buildRunId,
          base_version: input.baseVersion,
          source_commit: input.sourceCommit,
          publish_mode: input.publishMode ?? "live",
        },
      }),
    });
    if (!response.ok) throw await failureOf(response, `dispatching ${eventType}`);
  };
}

/** Fetch a JSON audit record written by the feed repo; never throws. */
export function createFeedRecordFetcher(options: { fetchImpl?: typeof fetch } = {}) {
  const { fetchImpl = fetch } = options;
  return async (url: string): Promise<unknown> => {
    const response = await fetchImpl(url, { headers: { "Cache-Control": "no-cache" } });
    if (!response.ok) return null;
    return response.json();
  };
}
