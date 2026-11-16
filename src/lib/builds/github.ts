import { unzipSync } from "fflate";
import type { BuildPlan } from "../build/types";
import { PACKAGE_SOURCES } from "../catalog/types";
import type { BuildEngine } from "../domain/types";
import { ARTIFACT_SIZE_LIMIT_BYTES, ArtifactSizeLimitError } from "../image/postprocess";
import { buildDispatchRequest } from "./dispatch";
import { BUILD_STEPS, buildEngineOf } from "./types";
import type { BuildFailure, BuildFailureContext } from "./types";
import type { ArtifactDownload, BuildAdapter, RunUpdate } from "./types";

const API = "https://api.github.com";

export interface GitHubAdapterOptions {
  repo: string;
  token: string;
  workflow: string;
  /** Workflow file that runs source builds (ticket 13); defaults to source-build.yml. */
  sourceWorkflow?: string;
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
  html_url?: string;
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
    sourceWorkflow = "source-build.yml",
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

    async findRun(buildId: string, engine?: BuildEngine): Promise<string | null> {
      // Source builds live in their own workflow file (ticket 06/13).
      const workflowFile = engine === "source" ? sourceWorkflow : workflow;
      for (let attempt = 0; attempt < 15; attempt += 1) {
        const runs = await json<{ workflow_runs: WorkflowRun[] }>(
          `/repos/${repo}/actions/workflows/${workflowFile}/runs?event=repository_dispatch&per_page=20`,
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
      // Ticket 13: the engine chooses the event and the payload. A source plan
      // sends the ticket 06 recipe to `combinewrt-source-build`; nothing else
      // does, so a source build can never silently run as an ImageBuilder job.
      const request = buildDispatchRequest(plan, meta);
      await json(`/repos/${repo}/dispatches`, {
        method: "POST",
        body: JSON.stringify({
          event_type: request.eventType,
          client_payload: request.payload,
        }),
      });

      return { runId: await this.findRun(meta.buildId, buildEngineOf(plan)) };
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
            if (update.status === "failed") {
              update.error = summarizeFailure(text);
              update.failure = parseFailure(text) ?? {
                step: "workflow",
                package: null,
                source: null,
                version: null,
                message: update.error,
              };
            }
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
      // Ticket 14: every artifact kind shares the 2 GiB per-artifact cap. The
      // cache enforces it again on the streamed byte count.
      if (size > ARTIFACT_SIZE_LIMIT_BYTES) {
        throw new ArtifactSizeLimitError(size, ARTIFACT_SIZE_LIMIT_BYTES);
      }
      return {
        name: `${artifact.name}.zip`,
        contentType: "application/zip",
        size: size || undefined,
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

export interface WorkflowRunSummary {
  id: string;
  workflow: string;
  status: string;
  conclusion: string | null;
  title: string;
  createdAt: string;
  url: string;
}

export interface WorkflowRunsOptions {
  repo: string;
  token: string;
  workflow: string;
  limit?: number;
  fetchImpl?: typeof fetch;
}

export async function listWorkflowRuns(options: WorkflowRunsOptions): Promise<WorkflowRunSummary[]> {
  const { repo, token, workflow, limit = 5, fetchImpl = fetch } = options;
  const perPage = Math.max(1, Math.min(20, limit));
  const response = await fetchImpl(
    `${API}/repos/${repo}/actions/workflows/${workflow}/runs?per_page=${perPage}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) {
    const body = (await response.text()).slice(0, 500);
    throw new Error(`GitHub GET workflow runs failed: ${response.status} ${body}`);
  }
  const payload = (await response.json()) as { workflow_runs?: WorkflowRun[] };
  return (payload.workflow_runs ?? []).slice(0, perPage).map((run) => ({
    id: String(run.id),
    workflow,
    status: run.status,
    conclusion: run.conclusion,
    title: run.display_title ?? run.name ?? "",
    createdAt: run.created_at,
    url: run.html_url ?? `https://github.com/${repo}/actions/runs/${run.id}`,
  }));
}


export interface FindWorkflowRunOptions extends WorkflowRunsOptions {
  titleIncludes: string;
  after?: string;
  attempts?: number;
  sleep?: (ms: number) => Promise<void>;
}

export async function findWorkflowRunByTitle(options: FindWorkflowRunOptions): Promise<string | null> {
  const { titleIncludes, after, attempts = 10, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = options;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const runs = await listWorkflowRuns({ ...options, limit: 20 });
    const afterMs = after ? Date.parse(after) : null;
    const match = runs.find((run) => {
      if (run.title.trim() !== titleIncludes) return false;
      return afterMs === null || Date.parse(run.createdAt) >= afterMs;
    });
    if (match) return match.id;
    await sleep(1_000);
  }
  return null;
}

export interface ManifestArtifactRef {
  name: string | null;
  sha256: string;
  size: number;
}

/**
 * The manifest the workflow prints as `COMBINEWRT_MANIFEST=`.
 *
 * V1 builds emit `{artifactName, path, sha256, size}`; V2 builds add the plan
 * context and, for VMDK/qcow2, the raw image the converted artifact came from.
 * Only `sha256`/`size` are required so both shapes parse with one code path.
 */
export interface BuildManifest {
  artifactName?: string;
  sha256: string;
  size: number;
  schemaVersion: 1 | 2;
  target?: { id: string; architecture: string; subtarget: string };
  kernelLine?: { id: string; version: string; engine: string };
  variant?: { boot: string; filesystem: string; artifact: string; overlaySizeMb?: number };
  engine?: string;
  /** Raw combined `.img` that the VMDK/qcow2 postprocess step converted. */
  raw?: ManifestArtifactRef;
  /** Converted artifact; repeats the top-level sha256/size. */
  converted?: ManifestArtifactRef;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseArtifactRef(value: unknown): ManifestArtifactRef | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const ref = value as Record<string, unknown>;
  if (typeof ref.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(ref.sha256)) return null;
  if (typeof ref.size !== "number" || !Number.isFinite(ref.size) || ref.size <= 0) return null;
  return { name: nonEmptyString(ref.name), sha256: ref.sha256, size: ref.size };
}

export function parseManifest(log: string): BuildManifest | null {
  const matches = [...log.matchAll(/COMBINEWRT_MANIFEST=(\{[^\n]*\})/g)];
  const last = matches.at(-1)?.[1];
  if (!last) return null;
  try {
    const parsed = JSON.parse(last) as Record<string, unknown>;
    if (typeof parsed.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(parsed.sha256)) return null;
    if (typeof parsed.size !== "number" || !Number.isFinite(parsed.size) || parsed.size <= 0) return null;
    const manifest: BuildManifest = {
      sha256: parsed.sha256,
      size: parsed.size,
      schemaVersion: parsed.schemaVersion === 2 ? 2 : 1,
    };
    if (typeof parsed.artifactName === "string") manifest.artifactName = parsed.artifactName;
    if (parsed.target && typeof parsed.target === "object") {
      const target = parsed.target as Record<string, unknown>;
      const id = nonEmptyString(target.id);
      const architecture = nonEmptyString(target.architecture);
      const subtarget = nonEmptyString(target.subtarget);
      if (id && architecture && subtarget) manifest.target = { id, architecture, subtarget };
    }
    if (parsed.kernelLine && typeof parsed.kernelLine === "object") {
      const kernelLine = parsed.kernelLine as Record<string, unknown>;
      const id = nonEmptyString(kernelLine.id);
      const version = nonEmptyString(kernelLine.version);
      const engine = nonEmptyString(kernelLine.engine);
      if (id && version && engine) manifest.kernelLine = { id, version, engine };
    }
    if (parsed.variant && typeof parsed.variant === "object") {
      const variant = parsed.variant as Record<string, unknown>;
      const boot = nonEmptyString(variant.boot);
      const filesystem = nonEmptyString(variant.filesystem);
      const artifact = nonEmptyString(variant.artifact);
      if (boot && filesystem && artifact) {
        manifest.variant = {
          boot,
          filesystem,
          artifact,
          ...(typeof variant.overlaySizeMb === "number" && Number.isFinite(variant.overlaySizeMb)
            ? { overlaySizeMb: variant.overlaySizeMb }
            : {}),
        };
      }
    }
    const engine = nonEmptyString(parsed.engine);
    if (engine) manifest.engine = engine;
    const raw = parseArtifactRef(parsed.raw);
    if (raw) manifest.raw = raw;
    const converted = parseArtifactRef(parsed.converted);
    if (converted) manifest.converted = converted;
    return manifest;
  } catch {
    return null;
  }
}

function parseFailureContext(value: unknown): BuildFailureContext | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const context: BuildFailureContext = {};
  const target = nonEmptyString(raw.target);
  if (target) context.target = target;
  const variant = nonEmptyString(raw.variant);
  if (variant) context.variant = variant;
  if (raw.engine === "imagebuilder" || raw.engine === "source") context.engine = raw.engine as BuildEngine;
  return Object.keys(context).length > 0 ? context : null;
}

export function parseFailure(log: string): BuildFailure | null {
  const markers = [...log.matchAll(/COMBINEWRT_FAILURE=(\{[^\n]*\})/g)];
  for (const marker of markers.reverse()) {
    try {
      const parsed = JSON.parse(marker[1]) as Record<string, unknown>;
      if (typeof parsed.step !== "string" || !(BUILD_STEPS as readonly string[]).includes(parsed.step)) continue;
      const source = typeof parsed.source === "string" && (PACKAGE_SOURCES as readonly string[]).includes(parsed.source)
        ? (parsed.source as (typeof PACKAGE_SOURCES)[number])
        : null;
      const failure: BuildFailure = {
        step: parsed.step as (typeof BUILD_STEPS)[number],
        package: typeof parsed.package === "string" && parsed.package ? parsed.package : null,
        source,
        version: typeof parsed.version === "string" && parsed.version ? parsed.version : null,
        message: typeof parsed.message === "string" && parsed.message ? parsed.message : "workflow failed",
      };
      const context = parseFailureContext(parsed.context);
      if (context) failure.context = context;
      return failure;
    } catch {
      // Ignore malformed markers; a later marker may still be valid.
    }
  }

  const legacy = [...log.matchAll(/COMBINEWRT_FAILED_PACKAGE=([^\s]+)/g)].at(-1)?.[1];
  if (legacy) {
    return {
      step: "assert-packages",
      package: legacy,
      source: null,
      version: null,
      message: `package ${legacy} is missing from the generated image`,
    };
  }
  return null;
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
