import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: { sub: "admin", iat: 0, exp: 0 } as { sub: string; iat: number; exp: number } | null,
  build: null as unknown,
  base: null as unknown,
}));

vi.mock("@/lib/auth/current-session", () => ({
  getSession: vi.fn(async () => state.session),
}));

vi.mock("@/lib/builds", () => ({
  getBuildService: () => ({ get: () => state.build }),
}));

vi.mock("@/lib/db", () => ({
  getDatabase: () => ({}),
}));

vi.mock("@/lib/base/store", () => ({
  createBaseVersionStore: () => ({ get: () => state.base }),
}));

import { GET } from "./route";

const plan = {
  baseVersion: "25.12.2",
  feedCommit: "feed",
  sourceNote: "fixture",
  profileId: "generic",
  profileTitle: "Generic x86/64",
  imageType: "ext4-efi",
  packages: ["lucky"],
  resolved: [
    {
      name: "lucky",
      version: "3.5.0-r1",
      source: "selected",
      packageSource: "dllkids",
      sourcePin: "dllkids-index-sha",
      sha256: "a".repeat(64),
      feed: "dllkids",
      license: "GPL-3.0-only",
      proprietary: false,
    },
  ],
  missingDependencies: [],
  conflicts: [],
  files: [],
  artifactName: "image.img.gz",
  imageBuilderCommand: "make image",
  createdAt: "2026-11-13T00:00:00.000Z",
  sourcePins: {
    official: {},
    dllkids: "dllkids-index-sha",
    supplement: null,
    kernel: null,
  },
  topLevelPackages: ["lucky"],
  downloads: [],
  patches: [],
  compliance: { publicEligible: true, issues: [] },
};

const params = { params: Promise.resolve({ id: "build-1" }) };

beforeEach(() => {
  state.session = { sub: "admin", iat: 0, exp: 0 };
  state.build = {
    id: "build-1",
    plan,
    status: "succeeded",
    runId: "42",
    adapter: "github",
    logTail: "",
    error: null,
    artifactName: "image.img.gz",
    createdAt: "2026-11-13T00:00:00.000Z",
    updatedAt: "2026-11-13T00:00:00.000Z",
  };
  state.base = {
    version: "25.12.2",
    releaseDate: "2026-09-08",
    imageBuilderUrl: "https://example.test/ib.tar.zst",
    imageBuilderSha256: "b".repeat(64),
    createdAt: "2026-09-08T00:00:00.000Z",
  };
});

describe("GET /api/builds/[id]/source-offer", () => {
  it("requires a session", async () => {
    state.session = null;
    const response = await GET(new Request("http://localhost/api/builds/build-1/source-offer"), params);
    expect(response.status).toBe(401);
  });

  it("returns 404 for an unknown build", async () => {
    state.build = null;
    const response = await GET(new Request("http://localhost/api/builds/build-1/source-offer"), params);
    expect(response.status).toBe(404);
  });

  it("returns the manifest as a private JSON attachment", async () => {
    const response = await GET(new Request("http://localhost/api/builds/build-1/source-offer"), params);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="source-offer-build-1.json"');
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = (await response.json()) as { openwrtTag: string; packages: Array<{ name: string }> };
    expect(body.openwrtTag).toBe("v25.12.2");
    expect(body.packages.map((pkg) => pkg.name)).toEqual(["lucky"]);
  });
});
