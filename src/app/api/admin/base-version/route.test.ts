import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: null as { sub: string; iat: number; exp: number } | null,
  bump: vi.fn(),
  revert: vi.fn(),
}));

vi.mock("@/lib/auth/current-session", () => ({
  getSession: vi.fn(async () => state.session),
}));

vi.mock("@/lib/base", () => ({
  getBaseVersionService: () => ({ bump: state.bump, revert: state.revert }),
  readBaseVersionState: async () => ({ active: { version: "25.12.2" } }),
}));

import { POST } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/admin/base-version", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.session = { sub: "admin", iat: 0, exp: 1 };
  state.bump.mockReset();
  state.revert.mockReset();
});

describe("POST /api/admin/base-version", () => {
  it("rejects anonymous requests", async () => {
    state.session = null;
    expect((await POST(request({ action: "bump", version: "25.12.3" }))).status).toBe(401);
  });

  it("rejects unknown actions", async () => {
    expect((await POST(request({ action: "delete" }))).status).toBe(400);
  });

  it("requires a stable version for bump", async () => {
    expect((await POST(request({ action: "bump", version: "25.12-SNAPSHOT" }))).status).toBe(400);
    expect(state.bump).not.toHaveBeenCalled();
  });

  it("bumps to the requested baseline", async () => {
    state.bump.mockResolvedValue(undefined);
    const response = await POST(request({ action: "bump", version: "25.12.3" }));
    expect(response.status).toBe(200);
    expect(state.bump).toHaveBeenCalledWith("25.12.3");
  });

  it("reverts to the previous baseline", async () => {
    state.revert.mockResolvedValue(undefined);
    const response = await POST(request({ action: "revert" }));
    expect(response.status).toBe(200);
    expect(state.revert).toHaveBeenCalled();
  });

  it("returns a readable error when the service rejects", async () => {
    state.bump.mockRejectedValue(new Error("ImmortalWrt 25.12.3 has not been discovered yet"));
    const response = await POST(request({ action: "bump", version: "25.12.3" }));
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain("not been discovered");
  });
});
