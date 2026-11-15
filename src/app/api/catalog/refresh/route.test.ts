import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: null as { sub: string; iat: number; exp: number } | null,
  run: vi.fn(),
}));

vi.mock("@/lib/auth/current-session", () => ({
  getSession: vi.fn(async () => state.session),
}));

vi.mock("@/lib/catalog/refresh-scheduler", () => ({
  getCatalogRefreshRunner: () => ({ run: state.run }),
}));

import { POST } from "./route";

beforeEach(() => {
  state.session = { sub: "admin", iat: 0, exp: 1 };
  state.run.mockReset();
});

describe("POST /api/catalog/refresh", () => {
  it("rejects anonymous requests", async () => {
    state.session = null;
    expect((await POST()).status).toBe(401);
  });

  it("reports an in-flight refresh as a skip, not a failure", async () => {
    state.run.mockResolvedValue({ ran: false, reason: "in-flight" });
    const response = await POST();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, skipped: true, reason: "in-flight" });
  });

  it("returns the refreshed snapshot", async () => {
    state.run.mockResolvedValue({ ran: true, result: { created: true, snapshot: { id: 7 } } });
    const response = await POST();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, created: true, snapshot: { id: 7 } });
  });

  it("returns 502 when the refresh fails", async () => {
    state.run.mockResolvedValue({ ran: true, error: "upstream 503" });
    const response = await POST();
    expect(response.status).toBe(502);
    expect(((await response.json()) as { error: string }).error).toContain("upstream 503");
  });
});
