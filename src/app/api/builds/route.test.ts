import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: { sub: "admin", iat: 0, exp: 0 } as { sub: string; iat: number; exp: number } | null,
  prepared: null as unknown,
  preparedV2: null as unknown,
  build: null as unknown,
  listed: [] as unknown[],
}));

vi.mock("@/lib/auth/current-session", () => ({
  getSession: vi.fn(async () => state.session),
}));

vi.mock("@/lib/builds/prepare", () => ({
  preparePlanForForm: vi.fn(async () => state.prepared),
  preparePlanV2ForForm: vi.fn(async () => state.preparedV2),
}));

vi.mock("@/lib/builds", () => ({
  recordSubmitBody: vi.fn(),
  getBuildService: () => ({
    submit: vi.fn(async () => state.build),
    list: vi.fn(() => state.listed),
    count: vi.fn(() => state.listed.length),
    refreshActive: vi.fn(async () => state.listed),
  }),
}));

import { GET, POST } from "./route";

const v2form = {
  schemaVersion: 2,
  target: "x86/64",
  profile: "generic",
  kernelLine: "6.12",
  imageVariant: { boot: "efi", filesystem: "ext4", artifact: "combined" },
  basePreset: "minimal",
  hostname: "router",
  timezone: "Asia/Shanghai",
  lanIp: "192.168.1.1",
  netmask: "255.255.255.0",
  rootPassword: "correct horse",
  packages: ["luci"],
};

const form = {
  profile: "generic",
  imageType: "ext4-efi",
  hostname: "router",
  timezone: "Asia/Shanghai",
  lanIp: "192.168.1.1",
  netmask: "255.255.255.0",
  rootPassword: "correct horse",
  packages: ["luci"],
};

const plan = {
  profileId: "generic",
  profileTitle: "Generic x86/64",
  imageType: "ext4-efi",
  packages: ["luci"],
  resolved: [],
  missingDependencies: [],
  conflicts: [],
  files: [],
  artifactName: "image.img.gz",
  imageBuilderCommand: "make image",
  baseVersion: "25.12.2",
  feedCommit: "abc",
  sourceNote: "fixture",
  createdAt: "2026-11-11T00:00:00.000Z",
};

function post(body: unknown = form) {
  return new Request("http://localhost/api/builds", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.session = { sub: "admin", iat: 0, exp: 0 };
  state.prepared = { ok: true, plan, conflicts: [] };
  state.preparedV2 = { ok: true, plan: { ...plan, schemaVersion: 2 }, conflicts: [] };
  state.build = { id: "b1", status: "queued" };
  state.listed = [];
});

describe("POST /api/builds", () => {
  it("requires a session", async () => {
    state.session = null;
    const response = await POST(post());
    expect(response.status).toBe(401);
  });

  it("rejects an invalid form", async () => {
    const response = await POST(post({ ...form, hostname: "bad_host" }));
    expect(response.status).toBe(400);
  });

  it("creates a build and returns it", async () => {
    const response = await POST(post());
    expect(response.status).toBe(201);
    expect((await response.json()).build.id).toBe("b1");
  });

  it("blocks conflicting packages", async () => {
    state.prepared = {
      ok: true,
      plan: { ...plan, conflicts: [{ names: ["dnsmasq", "dnsmasq-full"], message: "冲突" }] },
      conflicts: [{ names: ["dnsmasq", "dnsmasq-full"], message: "冲突" }],
    };
    const response = await POST(post());
    expect(response.status).toBe(409);
  });

  it("returns 502 when dispatch fails", async () => {
    state.build = { id: "b1", status: "failed", error: "bad token" };
    const response = await POST(post());
    expect(response.status).toBe(502);
    expect((await response.json()).error).toBe("bad token");
  });

  it("accepts a V2 form and enqueues the V2 plan", async () => {
    const response = await POST(post(v2form));
    expect(response.status).toBe(201);
    expect((await response.json()).build.id).toBe("b1");
  });

  it("rejects an invalid V2 variant", async () => {
    const response = await POST(
      post({ ...v2form, imageVariant: { boot: "efi", filesystem: "ext4", artifact: "not-an-artifact" } }),
    );
    expect(response.status).toBe(400);
  });

  it("answers 409 with the V2 conflicts and the readable plan", async () => {
    state.preparedV2 = {
      ok: true,
      plan: { ...plan, schemaVersion: 2 },
      conflicts: [{ names: ["docker"], message: "Mode docker requires the source engine" }],
    };
    const response = await POST(post(v2form));
    expect(response.status).toBe(409);
    const data = await response.json();
    expect(data.conflicts[0].message).toContain("source engine");
    expect(data.plan.schemaVersion).toBe(2);
  });
});

describe("GET /api/builds", () => {
  it("lists builds", async () => {
    state.listed = [{ id: "b1" }];
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).builds).toHaveLength(1);
  });
});
