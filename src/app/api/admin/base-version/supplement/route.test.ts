import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: null as { sub: string; iat: number; exp: number } | null,
  active: true as boolean,
  trigger: vi.fn(),
  runs: [] as Array<{ id: string; title: string; status: string; conclusion: string | null; createdAt: string; workflow: string; url: string }>,
}));

vi.mock("@/lib/auth/current-session", () => ({
  getSession: vi.fn(async () => state.session),
}));

vi.mock("@/lib/config", () => ({
  getConfig: () => ({
    buildAdapter: "github",
    buildRepo: "wuyuzaddd/combinewrt-build",
    buildRepoToken: "token",
    supplementWorkflow: "packages.yml",
  }),
}));

vi.mock("@/lib/builds/github", () => ({
  listWorkflowRuns: vi.fn(async () => state.runs),
}));

vi.mock("@/lib/base", () => ({
  getBaseVersionService: () => ({ triggerSupplementBuildNow: state.trigger }),
  readBaseVersionState: () => ({
    active: state.active ? { version: "25.12.2" } : null,
    previous: null,
    candidate: null,
    check: null,
    smoke: null,
    supplementBuild: null,
  }),
}));

import { POST } from "./route";

beforeEach(() => {
  state.session = { sub: "admin", iat: 0, exp: 1 };
  state.active = true;
  state.runs = [];
  state.trigger.mockReset();
});

describe("POST /api/admin/base-version/supplement", () => {
  it("rejects anonymous requests", async () => {
    state.session = null;
    expect((await POST()).status).toBe(401);
  });

  it("requires an active baseline", async () => {
    state.active = false;
    const response = await POST();
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain("没有启用的基础版本");
  });

  it("rejects a duplicate trigger while a supplement run is active", async () => {
    state.runs = [
      {
        id: "55",
        title: "packages 25.12.2",
        status: "in_progress",
        conclusion: null,
        createdAt: "2026-11-15T00:00:00Z",
        workflow: "packages.yml",
        url: "https://github.com/x/y/actions/runs/55",
      },
    ];
    const response = await POST();
    expect(response.status).toBe(409);
    expect(state.trigger).not.toHaveBeenCalled();
  });

  it("triggers the supplement build for the active baseline", async () => {
    state.trigger.mockResolvedValue({ baseVersion: "25.12.2", runId: "55", error: null });
    const response = await POST();
    expect(response.status).toBe(200);
    expect(state.trigger).toHaveBeenCalledWith("25.12.2");
  });

  it("returns 502 and a readable message when dispatch fails", async () => {
    state.trigger.mockRejectedValue(new Error("dispatch denied"));
    const response = await POST();
    expect(response.status).toBe(502);
    expect(((await response.json()) as { error: string }).error).toContain("dispatch denied");
  });
});
