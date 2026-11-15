import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: null as { sub: string; iat: number; exp: number } | null,
}));

vi.mock("@/lib/auth/current-session", () => ({
  getSession: vi.fn(async () => state.session),
}));

import { GET } from "./route";

const INDEX = `<a href="25.12.2/">25.12.2</a>/</td><td class="s">-</td><td class="d">Tue Sep  8 21:42:22 2026</td>`;
const SUMS = "b9b290f5ef60a22bccd5bdca9c1e7523b8fc84e60462afbf550e20db94acf2c6 *immortalwrt-imagebuilder-25.12.2-x86-64.Linux-x86_64.tar.zst";

function request(version: string) {
  return new Request(`http://localhost/api/admin/base-version/discover?version=${version}`);
}

beforeEach(() => {
  state.session = { sub: "admin", iat: 0, exp: 1 };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/admin/base-version/discover", () => {
  it("rejects anonymous requests", async () => {
    state.session = null;
    expect((await GET(request("25.12.2"))).status).toBe(401);
  });

  it("rejects unstable version strings", async () => {
    expect((await GET(request("25.12-SNAPSHOT"))).status).toBe(400);
  });

  it("fills release date, ImageBuilder URL and checksum", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.endsWith("/releases")) return new Response(INDEX);
        if (url.endsWith("/sha256sums")) return new Response(SUMS);
        return new Response("not found", { status: 404 });
      }),
    );
    const response = await GET(request("25.12.2"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      candidate: { releaseDate: string; imageBuilderUrl: string; imageBuilderSha256: string };
    };
    expect(body.candidate.releaseDate).toBe("2026-09-08");
    expect(body.candidate.imageBuilderUrl).toContain("immortalwrt-imagebuilder-25.12.2");
    expect(body.candidate.imageBuilderSha256).toBe("b9b290f5ef60a22bccd5bdca9c1e7523b8fc84e60462afbf550e20db94acf2c6");
  });

  it("returns 404 when the release is not in the official index", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('<a href="25.12.2/">25.12.2</a>/</td><td class="s">-</td><td class="d">Tue Sep  8 21:42:22 2026</td>')),
    );
    const response = await GET(request("25.12.3"));
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: string }).error).toContain("was not found");
  });
});
