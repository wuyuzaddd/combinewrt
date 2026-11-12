import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: null as { sub: string; iat: number; exp: number } | null,
  check: vi.fn(),
}));

vi.mock("@/lib/auth/current-session", () => ({
  getSession: vi.fn(async () => state.session),
}));

vi.mock("@/lib/base", () => ({
  getBaseVersionService: () => ({ checkForNewRelease: state.check }),
  readBaseVersionState: async () => ({ active: { version: "25.12.2" } }),
}));

import { POST } from "./route";

beforeEach(() => {
  state.session = { sub: "admin", iat: 0, exp: 1 };
  state.check.mockReset();
});

describe("POST /api/admin/base-version/check", () => {
  it("rejects anonymous requests", async () => {
    state.session = null;
    expect((await POST()).status).toBe(401);
    expect(state.check).not.toHaveBeenCalled();
  });

  it("returns the check result", async () => {
    state.check.mockResolvedValue({ checkedAt: "2026-10-02T00:00:00.000Z", latest: null, error: null });
    const response = await POST();
    expect(response.status).toBe(200);
    expect(((await response.json()) as { ok: boolean }).ok).toBe(true);
  });

  it("returns 502 when discovery fails", async () => {
    state.check.mockResolvedValue({ checkedAt: "2026-10-02T00:00:00.000Z", latest: null, error: "HTTP 500" });
    const response = await POST();
    expect(response.status).toBe(502);
    expect(((await response.json()) as { error: string }).error).toBe("HTTP 500");
  });
});
