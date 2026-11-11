import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: { sub: "admin", iat: 0, exp: 0 } as { sub: string; iat: number; exp: number } | null,
  current: null as unknown,
  cancelled: null as unknown,
}));

vi.mock("@/lib/auth/current-session", () => ({
  getSession: vi.fn(async () => state.session),
}));

vi.mock("@/lib/builds", () => ({
  getBuildService: () => ({
    get: vi.fn(() => state.current),
    cancel: vi.fn(async () => state.cancelled),
  }),
}));

import { POST } from "./route";

const params = { params: Promise.resolve({ id: "b1" }) };

describe("POST /api/builds/[id]/cancel", () => {
  beforeEach(() => {
    state.session = { sub: "admin", iat: 0, exp: 0 };
    state.current = null;
    state.cancelled = null;
  });

  it("returns 401 anonymously", async () => {
    state.session = null;
    const response = await POST(new Request("http://localhost"), params);
    expect(response.status).toBe(401);
  });

  it("returns 404 for unknown builds", async () => {
    const response = await POST(new Request("http://localhost"), params);
    expect(response.status).toBe(404);
  });

  it("returns 409 for finished builds", async () => {
    state.current = { id: "b1", status: "succeeded" };
    const response = await POST(new Request("http://localhost"), params);
    expect(response.status).toBe(409);
  });

  it("cancels an active build", async () => {
    state.current = { id: "b1", status: "running" };
    state.cancelled = { id: "b1", status: "cancelled" };
    const response = await POST(new Request("http://localhost"), params);
    expect(response.status).toBe(200);
    expect((await response.json()).build.status).toBe("cancelled");
  });
});
