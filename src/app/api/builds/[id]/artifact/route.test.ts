import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: { sub: "admin", iat: 0, exp: 0 } as { sub: string; iat: number; exp: number } | null,
  build: null as unknown,
  artifact: null as unknown,
  throws: false,
}));

vi.mock("@/lib/auth/current-session", () => ({
  getSession: vi.fn(async () => state.session),
}));

vi.mock("@/lib/builds", () => ({
  getBuildService: () => ({
    refresh: vi.fn(async () => state.build),
    artifact: vi.fn(async () => {
      if (state.throws) throw new Error("GitHub artifact download failed: 403");
      return state.artifact;
    }),
  }),
}));

import { GET } from "./route";

const params = { params: Promise.resolve({ id: "b1" }) };

beforeEach(() => {
  state.session = { sub: "admin", iat: 0, exp: 0 };
  state.build = { id: "b1", status: "succeeded", artifactName: "image.zip" };
  state.artifact = { name: "image.zip", contentType: "application/zip", body: new Uint8Array([1, 2]) };
  state.throws = false;
});

describe("GET /api/builds/[id]/artifact", () => {
  it("requires a session", async () => {
    state.session = null;
    const response = await GET(new Request("http://localhost/api/builds/b1/artifact"), params);
    expect(response.status).toBe(401);
  });

  it("returns 404 for an unknown build", async () => {
    state.build = null;
    const response = await GET(new Request("http://localhost/api/builds/b1/artifact"), params);
    expect(response.status).toBe(404);
  });

  it("returns 409 before the artifact is ready", async () => {
    state.build = { id: "b1", status: "running", artifactName: null };
    const response = await GET(new Request("http://localhost/api/builds/b1/artifact"), params);
    expect(response.status).toBe(409);
  });

  it("returns 502 when the upstream download fails", async () => {
    state.throws = true;
    const response = await GET(new Request("http://localhost/api/builds/b1/artifact"), params);
    expect(response.status).toBe(502);
  });

  it("streams the artifact with a sanitized filename", async () => {
    state.artifact = { name: 'bad"name.zip', contentType: "application/zip", body: new Uint8Array([1, 2]) };
    const response = await GET(new Request("http://localhost/api/builds/b1/artifact"), params);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="badname.zip"');
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
