import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: null as { sub: string; iat: number; exp: number } | null,
  bump: vi.fn(),
  revert: vi.fn(),
  register: vi.fn(),
}));

vi.mock("@/lib/auth/current-session", () => ({
  getSession: vi.fn(async () => state.session),
}));

vi.mock("@/lib/base", () => ({
  getBaseVersionService: () => ({ bump: state.bump, revert: state.revert, register: state.register }),
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
  state.register.mockReset();
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

  it("registers a manually entered record without switching the baseline", async () => {
    state.register.mockReturnValue({ version: "25.12.3", createdAt: "2026-10-01T00:00:00.000Z" });
    const body = {
      action: "register",
      version: "25.12.3",
      releaseDate: "2026-10-01",
      imageBuilderUrl:
        "https://downloads.immortalwrt.org/releases/25.12.3/targets/x86/64/immortalwrt-imagebuilder-25.12.3-x86-64.Linux-x86_64.tar.zst",
      imageBuilderSha256: "a".repeat(64),
    };
    const response = await POST(request(body));
    expect(response.status).toBe(200);
    expect(state.register).toHaveBeenCalledWith({
      version: "25.12.3",
      releaseDate: "2026-10-01",
      imageBuilderUrl: body.imageBuilderUrl,
      imageBuilderSha256: "a".repeat(64),
    });
    expect(state.bump).not.toHaveBeenCalled();
  });

  it("rejects an invalid manual record with readable field errors", async () => {
    const response = await POST(
      request({ action: "register", version: "25.12.3", releaseDate: "nope", imageBuilderUrl: "", imageBuilderSha256: "x" }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { errors: string[] };
    expect(body.errors.join("\n")).toContain("发布日期");
    expect(state.register).not.toHaveBeenCalled();
  });

  it("returns a readable error when the service rejects", async () => {
    state.bump.mockRejectedValue(new Error("ImmortalWrt 25.12.3 has not been discovered yet"));
    const response = await POST(request({ action: "bump", version: "25.12.3" }));
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain("not been discovered");
  });
});
