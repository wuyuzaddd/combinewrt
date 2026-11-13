import { unzipSync } from "fflate";
import type { BuildPlan } from "../build/types";
import type { ArtifactDownload, BuildAdapter, RunUpdate } from "./types";

const API = "https://api.github.com";

export interface GitHubAdapterOptions {
  repo: string;
  token: string;
  workflow: string;
  ref?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

interface WorkflowRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  created_at: string;
  display_title?: string;
}

export function mapRunState(run: WorkflowRun): RunUpdate {
  if (run.status !== "completed") {
    return { status: run.status === "in_progress" ? "running" : "queued" };
  }
  if (run.conclusion === "success") {
    return { status: "succeeded", error: null };
  }
  if (run.conclusion === "cancelled") {
    return { status: "cancelled", error: null };
  }
  return { status: "failed", error: `workflow concluded with ${run.conclusion ?? "unknown"}` };
}

function tailLogs(zip: Uint8Array): string {
  try {
    const files = unzipSync(zip);
    const text = Object.entries(files)
      .filter(([name]) => name.endsWith(".txt"))
      .map(([, content]) => new TextDecoder().decode(content))
      .join("\n");
    return text.length > 20_000 ? text.slice(-20_000) : text;
  } catch {
    return "";
  }
}

export function createGitHubAdapter(options: GitHubAdapterOptions): BuildAdapter {
  const {
    repo,
    token,
    workflow,
    fetchImpl = fetch,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = options;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  const withTimeout = (init: RequestInit = {}, ms = 15_000): RequestInit => ({
    ...init,
    signal: init.signal ?? AbortSignal.timeout(ms),
  });

  async function json<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetchImpl(
      `${API}${path}`,
      withTimeout({ ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) } }),
    );
    if (!response.ok) {
      const body = (await response.text()).slice(0, 500);
      throw new Error(`GitHub ${init.method ?? "GET"} ${path} failed: ${response.status} ${body}`);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  return {
    name: "github",

    async findRun(buildId: string): Promise<string | null> {
      for (let attempt = 0; attempt < 15; attempt += 1) {
        const runs = await json<{ workflow_runs: WorkflowRun[] }>(
          `/repos/${repo}/actions/workflows/${workflow}/runs?event=repository_dispatch&per_page=20`,
        );
        const match = runs.workflow_runs.find((run) => {
          const title = run.display_title ?? run.name ?? "";
          return title.includes(buildId);
        });
        if (match) return String(match.id);
        await sleep(1_000);
      }
      return null;
    },

    async dispatch(plan: BuildPlan, meta: { buildId: string; artifactName: string }) {
      const payload = {
        buildId: meta.buildId,
        baseVersion: plan.baseVersion,
        feedCommit: plan.feedCommit,
        profileId: plan.profileId,
        imageType: plan.imageType,
        packages: plan.packages,
        composition: {
          topLevelPackages: plan.topLevelPackages,
          sourcePins: plan.sourcePins,
          downloads: plan.downloads,
        },
        files: plan.files,
        artifactName: meta.artifactName,
        imageBuilderCommand: plan.imageBuilderCommand,
      };
      await json(`/repos/${repo}/dispatches`, {
        method: "POST",
        body: JSON.stringify({
          event_type: "combinewrt-build",
          client_payload: payload,
        }),
      });

      return { runId: await this.findRun(meta.buildId) };
    },

    async getRun(runId: string, expectedArtifactName?: string): Promise<RunUpdate> {
      const run = await json<WorkflowRun>(`/repos/${repo}/actions/runs/${runId}`);
      const update = mapRunState(run);
      if (run.status !== "completed") return update;

      try {
        const logs = await fetchImpl(`${API}/repos/${repo}/actions/runs/${runId}/logs`, withTimeout({ headers }));
        if (logs.ok) {
          const text = tailLogs(new Uint8Array(await logs.arrayBuffer()));
          if (text) {
            update.logTail = text;
            if (update.status === "failed") update.error = summarizeFailure(text);
            const manifest = parseManifest(text);
            if (manifest) {
              update.artifactSha256 = manifest.sha256;
              update.artifactSize = manifest.size;
              update.artifactName = update.artifactName ?? manifest.artifactName ?? null;
            }
          }
        }
      } catch {
        // logs are best-effort; status remains authoritative
      }

      try {
        const artifacts = await json<{ artifacts: { name: string }[] }>(`/repos/${repo}/actions/runs/${runId}/artifacts`);
        const picked = expectedArtifactName
          ? artifacts.artifacts.find((item) => item.name === expectedArtifactName)
          : artifacts.artifacts[0];
        if (picked) update.artifactName = picked.name;
      } catch {
        // artifacts may not exist yet
      }

      update.artifactName = update.artifactName ?? null;
      return update;
    },

    async cancelRun(runId: string) {
      const response = await fetchImpl(
        `${API}/repos/${repo}/actions/runs/${runId}/cancel`,
        withTimeout({ method: "POST", headers }),
      );
      if (!response.ok && response.status !== 409 && response.status !== 404) {
        const body = (await response.text()).slice(0, 500);
        throw new Error(`GitHub POST cancel failed: ${response.status} ${body}`);
      }
    },

    async downloadArtifact(runId: string, artifactName: string): Promise<ArtifactDownload> {
      const artifacts = await json<{ artifacts: { name: string; archive_download_url: string }[] }>(
        `/repos/${repo}/actions/runs/${runId}/artifacts`,
      );
      const artifact = artifacts.artifacts.find((item) => item.name === artifactName);
      if (!artifact) throw new Error(`artifact ${artifactName} is no longer available`);

      // The artifact body is streamed to the browser; a short header timeout would abort the transfer.
      const response = await fetchImpl(artifact.archive_download_url, withTimeout({ headers }, 600_000));
      if (!response.ok) throw new Error(`artifact download failed: ${response.status}`);
      const size = Number(response.headers.get("content-length") ?? "0");
      if (size > 512 * 1024 * 1024) throw new Error("artifact is larger than the 512 MB proxy limit");
      return {
        name: `${artifact.name}.zip`,
        contentType: "application/zip",
        size: Number(response.headers.get("content-length") ?? "0") || undefined,
        body: response.body ?? new Uint8Array(await response.arrayBuffer()),
      };
    },
  };
}

export interface RepositoryEventOptions {
  repo: string;
  token: string;
  eventType: string;
  clientPayload: Record<string, unknown>;
  fetchImpl?: typeof fetch;
}

export async function dispatchRepositoryEvent(options: RepositoryEventOptions): Promise<void> {
  const { repo, token, eventType, clientPayload, fetchImpl = fetch } = options;
  const response = await fetchImpl(`${API}/repos/${repo}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({ event_type: eventType, client_payload: clientPayload }),
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 500);
    throw new Error(`GitHub POST /repos/${repo}/dispatches failed: ${response.status} ${body}`);
  }
}

export interface BuildManifest {
  artifactName?: string;
  sha256: string;
  size: number;
}

export function parseManifest(log: string): BuildManifest | null {
  const matches = [...log.matchAll(/COMBINEWRT_MANIFEST=(\{[^\n]*\})/g)];
  const last = matches.at(-1)?.[1];
  if (!last) return null;
  try {
    const parsed = JSON.parse(last) as { artifactName?: unknown; sha256?: unknown; size?: unknown };
    if (typeof parsed.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(parsed.sha256)) return null;
    if (typeof parsed.size !== "number" || !Number.isFinite(parsed.size) || parsed.size <= 0) return null;
    return {
      artifactName: typeof parsed.artifactName === "string" ? parsed.artifactName : undefined,
      sha256: parsed.sha256,
      size: parsed.size,
    };
  } catch {
    return null;
  }
}

export function summarizeFailure(log: string): string {
  const lines = log
    .split("\n")
    .map((line) => line.replace(/\u001b\[[0-9;]*m/g, "").trim())
    .filter(Boolean);
  const relevant = lines.filter((line) => /error|failed|exit code|not found|denied/i.test(line));
  const picked = (relevant.length > 0 ? relevant : lines).slice(-6).join(" | ");
  return picked ? `workflow failed: ${picked.slice(0, 600)}` : "workflow failed";
}
