import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";

const state = vi.hoisted(() => ({
  session: null as { sub: string; iat: number; exp: number } | null,
  db: null as DatabaseSync | null,
}));

vi.mock("@/lib/auth/current-session", () => ({
  getSession: vi.fn(async () => state.session),
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return { ...actual, getDatabase: () => state.db };
});

vi.mock("@/lib/build/password", () => ({
  hashRootPassword: vi.fn(async () => "$6$salt$hash"),
}));

import { POST } from "./route";
import { openDatabase, migrate } from "@/lib/db";
import { createCatalogStore } from "@/lib/catalog/store";

function request(body: unknown) {
  return new Request("http://localhost/api/build/plan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validForm = {
  profile: "generic",
  imageType: "ext4-efi",
  hostname: "router",
  timezone: "Asia/Shanghai",
  lanIp: "192.168.1.1",
  netmask: "255.255.255.0",
  rootPassword: "correct horse",
  packages: ["luci"],
};

beforeAll(() => {
  const db = openDatabase(":memory:");
  migrate(db);
  const store = createCatalogStore(db);
  store.saveSnapshot({
    baseVersion: "25.12.2",
    feedCommit: "feed123",
    sourceNote: "fixture",
    sourcePins: { official: {}, dllkids: null, supplement: null, kernel: null },
    profiles: [{ id: "generic", title: "Generic x86/64", formats: ["ext4-efi"], imageCount: 25 }],
    packages: [
      {
        name: "luci",
        version: "1",
        arch: "all",
        description: "LuCI",
        license: "Apache-2.0",
        origin: "feeds/luci/luci",
        category: "luci",
        installedSize: 1024,
        depends: [],
        feed: "luci",
        proprietary: false,
        source: "official",
        sourcePin: "",
        sha256: null,
        fileSize: 0,
        filename: "luci-1.apk",
        downloadUrl: null,
        kmod: false,
      },
      {
        name: "dnsmasq",
        version: "1",
        arch: "x86_64",
        description: "dnsmasq",
        license: "GPL-2.0",
        origin: "feeds/base/dnsmasq",
        category: "base",
        installedSize: 1024,
        depends: [],
        feed: "base",
        proprietary: false,
        source: "official",
        sourcePin: "",
        sha256: null,
        fileSize: 0,
        filename: "dnsmasq-1.apk",
        downloadUrl: null,
        kmod: false,
      },
      {
        name: "dnsmasq-full",
        version: "1",
        arch: "x86_64",
        description: "dnsmasq full",
        license: "GPL-2.0",
        origin: "feeds/base/dnsmasq",
        category: "base",
        installedSize: 1024,
        depends: [],
        feed: "base",
        proprietary: false,
        source: "official",
        sourcePin: "",
        sha256: null,
        fileSize: 0,
        filename: "dnsmasq-1.apk",
        downloadUrl: null,
        kmod: false,
      },
    ],
  });
  state.db = db;
});

afterAll(() => {
  state.db?.close();
});

describe("POST /api/build/plan", () => {
  it("rejects anonymous requests", async () => {
    state.session = null;
    const response = await POST(request(validForm));
    expect(response.status).toBe(401);
  });

  it("returns validation issues", async () => {
    state.session = { sub: "admin", iat: 0, exp: 1 };
    const response = await POST(request({ ...validForm, hostname: "bad_host" }));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { issues: string[] };
    expect(body.issues.join("\n")).toMatch(/hostname/);
  });

  it("blocks conflicting packages", async () => {
    state.session = { sub: "admin", iat: 0, exp: 1 };
    const response = await POST(request({ ...validForm, packages: ["dnsmasq", "dnsmasq-full"] }));
    expect(response.status).toBe(409);
    const body = (await response.json()) as { conflicts: { message: string }[] };
    expect(body.conflicts[0].message).toContain("dnsmasq");
  });

  it("rejects a request that forces an unavailable source", async () => {
    state.session = { sub: "admin", iat: 0, exp: 1 };
    const response = await POST(request({ ...validForm, packages: ["dllkids/luci"] }));
    expect(response.status).toBe(409);
    const body = (await response.json()) as { conflicts: { message: string }[] };
    expect(body.conflicts[0].message).toContain("dllkids");
  });

  it("returns a plan without the plaintext password", async () => {
    state.session = { sub: "admin", iat: 0, exp: 1 };
    const response = await POST(request(validForm));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { plan: { artifactName: string; files: { content: string }[] } };
    expect(body.plan.artifactName).toBe("immortalwrt-25.12.2-x86-64-generic-ext4-combined-efi.img.gz");
    expect(JSON.stringify(body)).not.toContain("correct horse");
  });
});
