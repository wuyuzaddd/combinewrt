import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArtifactSizeLimitError } from "@/lib/image/postprocess";

const state = vi.hoisted(() => ({
  session: { sub: "admin", iat: 0, exp: 0 } as { sub: string; iat: number; exp: number } | null,
  build: null as unknown,
  file: null as unknown,
  artifact: null as unknown,
  throws: false,
  error: "GitHub artifact download failed: 403" as unknown,
}));

vi.mock("@/lib/auth/current-session", () => ({
  getSession: vi.fn(async () => state.session),
}));

vi.mock("@/lib/builds", () => ({
  getBuildService: () => ({
    refresh: vi.fn(async () => state.build),
    artifactFile: vi.fn(async () => {
      if (state.throws) throw state.error;
      return state.file;
    }),
    artifact: vi.fn(async () => {
      if (state.throws) throw state.error;
      return state.artifact;
    }),
  }),
}));

import { GET } from "./route";

const params = { params: Promise.resolve({ id: "b1" }) };
const dirs: string[] = [];
const CONTENT = "abcdefghijklmnopqrstuvwxyz";

function artifactPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "cw-download-"));
  dirs.push(dir);
  const path = join(dir, "image.img.gz");
  writeFileSync(path, CONTENT);
  return path;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  state.session = { sub: "admin", iat: 0, exp: 0 };
  state.build = { id: "b1", status: "succeeded", artifactName: "image.img.gz" };
  state.file = {
    name: "image.img.gz",
    containerName: "image.img.gz.zip",
    contentType: "application/zip",
    size: CONTENT.length,
    path: artifactPath(),
    kind: "combined",
    sha256: "c0ffee",
    imageSha256: "beef",
    imageSize: 123,
  };
  state.artifact = { name: "image.img.gz", contentType: "application/zip", body: new Uint8Array([1, 2]) };
  state.throws = false;
  state.error = "GitHub artifact download failed: 403";
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

  it("returns 409 with an expiry hint when the artifact is gone", async () => {
    state.throws = true;
    state.error = new Error("artifact build-b1 is no longer available");
    const response = await GET(new Request("http://localhost/api/builds/b1/artifact"), params);
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string; code: string };
    expect(body.code).toBe("expired");
    expect(body.error).toContain("过期");
  });

  it("returns 413 with both sizes when the artifact exceeds the cap", async () => {
    state.throws = true;
    state.error = new ArtifactSizeLimitError(3 * 1024 * 1024 * 1024, 2 * 1024 * 1024 * 1024);
    const response = await GET(new Request("http://localhost/api/builds/b1/artifact"), params);
    expect(response.status).toBe(413);
    const body = (await response.json()) as { code: string; error: string };
    expect(body.code).toBe("artifact-too-large");
    expect(body.error).toContain("2 GiB");
    expect(body.error).toContain("保护阈值");
  });

  it("returns the failure reason for a failed build", async () => {
    state.build = { id: "b1", status: "failed", artifactName: null, error: "workflow concluded with failure" };
    const response = await GET(new Request("http://localhost/api/builds/b1/artifact"), params);
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("concluded");
  });

  it("returns 502 for other upstream failures without leaking a stack", async () => {
    state.throws = true;
    state.error = new Error("GitHub GET /artifacts failed: 500");
    const response = await GET(new Request("http://localhost/api/builds/b1/artifact"), params);
    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("artifact download failed");
  });

  it("describes the ZIP container and the image inside it", async () => {
    const response = await GET(new Request("http://localhost/api/builds/b1/artifact"), params);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("x-checksum-sha256")).toBe("c0ffee");
    expect(response.headers.get("x-image-name")).toBe("image.img.gz");
    expect(response.headers.get("x-image-sha256")).toBe("beef");
    expect(response.headers.get("x-image-size")).toBe("123");
  });

  it("omits unknown digests instead of inventing one", async () => {
    state.file = {
      ...(state.file as Record<string, unknown>),
      sha256: null,
      imageSha256: null,
      imageSize: null,
    };
    const response = await GET(new Request("http://localhost/api/builds/b1/artifact"), params);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-checksum-sha256")).toBeNull();
    expect(response.headers.get("x-image-name")).toBe("image.img.gz");
    expect(response.headers.get("x-image-sha256")).toBeNull();
    expect(response.headers.get("x-image-size")).toBeNull();
  });

  it("serves the full artifact with a sanitized filename", async () => {
    state.file = {
      ...(state.file as Record<string, unknown>),
      containerName: 'bad"name.zip',
    };
    const response = await GET(new Request("http://localhost/api/builds/b1/artifact"), params);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="bad_name.zip"; filename*=UTF-8''bad%22name.zip`,
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-length")).toBe(String(CONTENT.length));
    expect(await response.text()).toBe(CONTENT);
  });

  it("serves a 206 partial body for a Range request", async () => {
    const response = await GET(
      new Request("http://localhost/api/builds/b1/artifact", { headers: { range: "bytes=0-3" } }),
      params,
    );
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(`bytes 0-3/${CONTENT.length}`);
    expect(response.headers.get("content-length")).toBe("4");
    expect(await response.text()).toBe("abcd");
  });

  it("serves an open-ended suffix range", async () => {
    const response = await GET(
      new Request("http://localhost/api/builds/b1/artifact", { headers: { range: "bytes=25-" } }),
      params,
    );
    expect(response.status).toBe(206);
    expect(await response.text()).toBe("z");
  });

  it("returns 416 for an unsatisfiable range", async () => {
    const response = await GET(
      new Request("http://localhost/api/builds/b1/artifact", { headers: { range: "bytes=999-" } }),
      params,
    );
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe(`bytes */${CONTENT.length}`);
  });

  it("ignores a multi-range header and serves the whole file", async () => {
    const response = await GET(
      new Request("http://localhost/api/builds/b1/artifact", { headers: { range: "bytes=0-1,4-5" } }),
      params,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(CONTENT);
  });

  it("falls back to the streaming download when no cache index exists", async () => {
    state.file = null;
    const response = await GET(new Request("http://localhost/api/builds/b1/artifact"), params);
    expect(response.status).toBe(200);
    // The uncached stream is still the ZIP container, so the headers say so.
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toContain("image.img.gz.zip");
    expect(response.headers.get("x-image-name")).toBe("image.img.gz");
    expect(response.headers.get("x-checksum-sha256")).toBeNull();
    // The streaming fallback does not handle Range, so it must not advertise it.
    expect(response.headers.get("accept-ranges")).toBeNull();
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2]));
  });
});
