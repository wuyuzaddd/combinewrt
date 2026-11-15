import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  fail: false,
}));

vi.mock("@/lib/config", () => ({
  loadConfig: vi.fn(() => {
    if (state.fail) throw new Error("SESSION_SECRET is required");
    return {};
  }),
}));

vi.mock("@/lib/db", () => ({
  getDatabase: vi.fn(() => ({
    prepare: () => ({ get: () => ({ ok: 1 }) }),
  })),
}));

import { GET } from "./route";

afterEach(() => {
  state.fail = false;
  vi.restoreAllMocks();
});

describe("GET /api/health", () => {
  it("returns ok when config and the database are usable", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("returns 503 with a readable server log when startup would fail", async () => {
    state.fail = true;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await GET();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ ok: false });
    expect(error).toHaveBeenCalledWith(
      "[combinewrt] health check failed:",
      expect.objectContaining({ message: "SESSION_SECRET is required" }),
    );
  });
});
