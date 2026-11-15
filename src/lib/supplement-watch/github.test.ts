import { describe, expect, it } from "vitest";
import {
  createFeedRecordFetcher,
  createGitHubPublishDispatcher,
  createGitHubRunReader,
  createGitHubSupplementDispatcher,
  createGitHubUpstreamObserver,
} from "./github";

interface Call {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
}

function fakeFetch(handler: (call: Call) => { status?: number; json?: unknown; text?: string }) {
  const calls: Call[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      url: String(url),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : null,
      headers: (init?.headers ?? {}) as Record<string, string>,
    };
    calls.push(call);
    const result = handler(call);
    const status = result.status ?? 200;
    return new Response(result.text ?? (result.json === undefined ? "" : JSON.stringify(result.json)), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("createGitHubUpstreamObserver", () => {
  it("reads the branch head commit and its commit date", async () => {
    const { impl, calls } = fakeFetch(() => ({
      json: { sha: "a".repeat(40), commit: { committer: { date: "2026-11-15T01:02:03Z" } } },
    }));
    const observe = createGitHubUpstreamObserver({ repo: "kiddin9/op-packages", ref: "main", token: "t0ken", fetchImpl: impl });

    await expect(observe()).resolves.toEqual({
      commit: "a".repeat(40),
      observedAt: "2026-11-15T01:02:03Z",
    });
    expect(calls[0].url).toBe("https://api.github.com/repos/kiddin9/op-packages/commits/main");
    expect(calls[0].headers.Authorization).toBe("Bearer t0ken");
  });

  it("fails loudly so the watch records an observation error", async () => {
    const { impl } = fakeFetch(() => ({ status: 404, text: "not found" }));
    const observe = createGitHubUpstreamObserver({ repo: "kiddin9/op-packages", ref: "main", token: "t", fetchImpl: impl });
    await expect(observe()).rejects.toThrow(/404/);
  });
});

describe("createGitHubSupplementDispatcher", () => {
  it("dispatches workflow_dispatch with base_version, source_commit and publish_mode", async () => {
    let dispatched = 0;
    const justNow = new Date(Date.now() + 1_000).toISOString();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { impl, calls } = fakeFetch((call) => {
      if (call.url.endsWith("/dispatches")) {
        dispatched += 1;
        return { status: 200, text: "" };
      }
      return {
        json: {
          workflow_runs: [
            { id: 42, created_at: justNow, html_url: "https://gh.test/runs/42" },
            { id: 41, created_at: yesterday, html_url: "https://gh.test/runs/41" },
          ],
        },
      };
    });

    const dispatch = createGitHubSupplementDispatcher({
      repo: "wuyuzaddd/combinewrt-build",
      workflow: "packages.yml",
      token: "tok",
      dispatchRef: "v2/ticket-11",
      fetchImpl: impl,
      sleep: async () => undefined,
    });

    const result = await dispatch({
      baseVersion: "25.12.2",
      sourceCommit: "b".repeat(40),
      publishMode: "staging",
      gateReason: "recipe_changed",
    });

    expect(dispatched).toBe(1);
    expect(result).toEqual({ runId: "42", url: "https://gh.test/runs/42" });
    const post = calls.find((call) => call.url.endsWith("/dispatches"));
    expect(post?.url).toBe(
      "https://api.github.com/repos/wuyuzaddd/combinewrt-build/actions/workflows/packages.yml/dispatches",
    );
    expect(post?.body).toEqual({
      ref: "v2/ticket-11",
      inputs: {
        base_version: "25.12.2",
        source_commit: "b".repeat(40),
        publish_mode: "staging",
        gate_reason: "recipe_changed",
      },
    });
  });

  it("returns an empty run id when the run never appears, instead of failing the dispatch", async () => {
    const { impl } = fakeFetch((call) =>
      call.url.endsWith("/dispatches") ? { status: 200, text: "" } : { json: { workflow_runs: [] } },
    );
    const dispatch = createGitHubSupplementDispatcher({
      repo: "r/b",
      workflow: "packages.yml",
      token: "tok",
      fetchImpl: impl,
      runLookupAttempts: 2,
      sleep: async () => undefined,
    });
    await expect(
      dispatch({ baseVersion: "25.12.2", sourceCommit: "c".repeat(40), publishMode: "live", gateReason: "metadata_unchanged" }),
    ).resolves.toEqual({ runId: "", url: null });
  });
});

describe("createGitHubRunReader", () => {
  it("maps the API status to the reconciler vocabulary", async () => {
    const { impl } = fakeFetch(() => ({
      json: { status: "completed", conclusion: "success", html_url: "https://gh.test/runs/7" },
    }));
    const read = createGitHubRunReader({ repo: "r/b", token: "t", fetchImpl: impl });
    await expect(read("7")).resolves.toEqual({
      status: "completed",
      conclusion: "success",
      url: "https://gh.test/runs/7",
    });
  });

  it("throws on an unknown run so reconcile counts an attempt", async () => {
    const { impl } = fakeFetch(() => ({ status: 404, text: "no run" }));
    const read = createGitHubRunReader({ repo: "r/b", token: "t", fetchImpl: impl });
    await expect(read("404")).rejects.toThrow(/404/);
  });
});

describe("createGitHubPublishDispatcher", () => {
  it("dispatches the feed repo event with the build run id and channel", async () => {
    const { impl, calls } = fakeFetch(() => ({ status: 200, text: "" }));
    const dispatch = createGitHubPublishDispatcher({ repo: "wuyuzaddd/combinewrt-packages", token: "t", fetchImpl: impl });
    await dispatch({
      buildRunId: "42",
      baseVersion: "25.12.2",
      sourceCommit: "d".repeat(40),
      publishMode: "live",
    });
    expect(calls[0].body).toEqual({
      event_type: "supplement-publish",
      client_payload: {
        build_run_id: "42",
        base_version: "25.12.2",
        source_commit: "d".repeat(40),
        publish_mode: "live",
      },
    });
  });
});

describe("createFeedRecordFetcher", () => {
  it("returns null instead of throwing when the audit record is not there yet", async () => {
    const { impl } = fakeFetch(() => ({ status: 404, text: "missing" }));
    const fetchRecord = createFeedRecordFetcher({ fetchImpl: impl });
    await expect(fetchRecord("https://feed.test/publish.json")).resolves.toBeNull();
  });
});
