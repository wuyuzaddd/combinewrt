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
      {
        name: "vendor-app",
        version: "1",
        arch: "x86_64",
        description: "closed vendor app",
        license: "Proprietary",
        origin: "feeds/vendor/vendor-app",
        category: "vendor",
        installedSize: 1024,
        depends: [],
        feed: "packages",
        proprietary: true,
        source: "official",
        sourcePin: "",
        sha256: null,
        fileSize: 0,
        filename: "vendor-app-1.apk",
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

  it("rejects a public plan with non-public packages", async () => {
    state.session = { sub: "admin", iat: 0, exp: 1 };
    const response = await POST(
      request({ ...validForm, packages: ["vendor-app"], visibility: "public" }),
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as { conflicts: { message: string }[] };
    expect(body.conflicts[0].message).toContain("vendor-app");
    expect(body.conflicts[0].message).toContain("official");
  });

  it("accepts the same package for a private build", async () => {
    state.session = { sub: "admin", iat: 0, exp: 1 };
    const response = await POST(request({ ...validForm, packages: ["vendor-app"] }));
    expect(response.status).toBe(200);
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

const validFormV2 = {
  ...validForm,
  // The V2 form states its schema explicitly; the route must not infer V2 from
  // field presence (a stray imageVariant no longer flips the V1 path).
  schemaVersion: 2,
  target: "x86/64",
  kernelLine: "6.12",
  imageVariant: { boot: "efi", filesystem: "ext4", artifact: "combined" },
};

describe("POST /api/build/plan (V2 form)", () => {
  it("returns a schemaVersion 2 plan for the V2 form", async () => {
    state.session = { sub: "admin", iat: 0, exp: 1 };
    const response = await POST(request(validFormV2));
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      plan: {
        schemaVersion: number;
        target: { id: string };
        kernelLine: { id: string; engine: string };
        imageVariant: { artifact: string };
        engine: string;
        visibility: string;
        artifactName: string;
      };
    };
    expect(body.plan.schemaVersion).toBe(2);
    expect(body.plan.target.id).toBe("x86/64");
    expect(body.plan.kernelLine).toMatchObject({ id: "6.12", engine: "imagebuilder" });
    expect(body.plan.imageVariant.artifact).toBe("combined");
    expect(body.plan.engine).toBe("imagebuilder");
    expect(body.plan.visibility).toBe("private");
    expect(body.plan.artifactName).toBe("immortalwrt-25.12.2-x86-64-generic-ext4-combined-efi.img.gz");
  });

  it("maps the legacy V1 form onto the implicit V2 defaults", async () => {
    state.session = { sub: "admin", iat: 0, exp: 1 };
    const response = await POST(request(validForm));
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      plan: {
        schemaVersion: number;
        target: { id: string };
        deviceProfile: { id: string };
        kernelLine: { id: string; engine: string };
        imageVariant: { boot: string; filesystem: string; artifact: string };
        basePreset: { id: string };
        overlays: unknown[];
        engine: string;
        visibility: string;
        artifactName: string;
        imageType: string;
      };
    };
    expect(body.plan.schemaVersion).toBe(2);
    expect(body.plan.target.id).toBe("x86/64");
    expect(body.plan.deviceProfile.id).toBe("generic");
    expect(body.plan.kernelLine).toMatchObject({ id: "6.12", engine: "imagebuilder" });
    expect(body.plan.imageVariant).toMatchObject({ boot: "efi", filesystem: "ext4", artifact: "combined" });
    expect(body.plan.basePreset.id).toBe("minimal");
    expect(body.plan.overlays).toEqual([]);
    expect(body.plan.engine).toBe("imagebuilder");
    expect(body.plan.visibility).toBe("private");
    // The plan's V1-compatibility imageType is derived from the variant; the
    // legacy form's imageType is not carried into the V2 planner input.
    expect(body.plan.imageType).toBe("ext4-efi");
    expect(body.plan.artifactName).toBe("immortalwrt-25.12.2-x86-64-generic-ext4-combined-efi.img.gz");
  });

  it("keeps the legacy 400 for an image type the profile does not offer", async () => {
    state.session = { sub: "admin", iat: 0, exp: 1 };
    const response = await POST(request({ ...validForm, imageType: "squashfs-efi" }));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { issues: string[] };
    expect(body.issues.join("\n")).toMatch(/imageType/);
  });

  it("keeps the legacy 400 for an unknown profile", async () => {
    state.session = { sub: "admin", iat: 0, exp: 1 };
    const response = await POST(request({ ...validForm, profile: "not-a-profile" }));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { issues: string[] };
    expect(body.issues.join("\n")).toMatch(/unknown profile/);
  });

  it("rejects a variant the capability registry does not support", async () => {
    state.session = { sub: "admin", iat: 0, exp: 1 };
    const response = await POST(
      request({ ...validFormV2, imageVariant: { boot: "efi", filesystem: "ext4", artifact: "emmc" } }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { issues: string[] };
    expect(body.issues.join("\n")).toMatch(/emmc/);
  });

  it("rejects an unmodelled kernel line without building a plan", async () => {
    state.session = { sub: "admin", iat: 0, exp: 1 };
    const five = await POST(request({ ...validFormV2, kernelLine: "5.15" }));
    expect(five.status).toBe(409);
    const fiveBody = (await five.json()) as { issues: string[] };
    expect(fiveBody.issues.join("\n")).toMatch(/5\.15/);

    const sixOne = await POST(request({ ...validFormV2, kernelLine: "6.1" }));
    expect(sixOne.status).toBe(409);
    const sixOneBody = (await sixOne.json()) as { issues: string[] };
    expect(sixOneBody.issues.join("\n")).toMatch(/6\.1/);
  });

  it("enforces the public-image gate on V2 plans", async () => {
    state.session = { sub: "admin", iat: 0, exp: 1 };
    const response = await POST(
      request({ ...validFormV2, packages: ["vendor-app"], visibility: "public" }),
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as { conflicts: { message: string }[]; plan: { visibility: string } };
    expect(body.conflicts.map((conflict) => conflict.message).join("\n")).toMatch(/vendor-app/);
    expect(body.plan.visibility).toBe("public");
  });

  it("rejects wan-eth0 together with switch-port as a readable 409", async () => {
    state.session = { sub: "admin", iat: 0, exp: 1 };
    const response = await POST(
      request({
        ...validFormV2,
        modes: [
          { id: "wan-eth0", layer: "file/board" },
          { id: "switch-port", layer: "file/board" },
        ],
        network: { switchPort: { wan: "wan", lan: ["lan1", "lan2"] } },
      }),
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as { conflicts: { names: string[]; message: string }[] };
    expect(body.conflicts[0].names).toEqual(expect.arrayContaining(["wan-eth0", "switch-port"]));
    expect(body.conflicts[0].message).toContain("wan-mapping");
  });

  it("rejects wifi without radio support as a readable 409", async () => {
    state.session = { sub: "admin", iat: 0, exp: 1 };
    const response = await POST(
      request({
        ...validFormV2,
        modes: [{ id: "wifi", layer: "file/board" }],
        network: {
          wifi: { ssid: "combinewrt", key: "correct horse", country: "CN", channel: 36, band: "5g" },
        },
      }),
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as { conflicts: { message: string }[]; plan: { modes: { experimental: string[] } } };
    expect(body.conflicts.map((conflict) => conflict.message).join("\n")).toMatch(/radio/);
    expect(body.plan.modes.experimental).toContain("wifi");
  });

  it("reports a mode the selected kernel line cannot run as a 409-grade conflict", async () => {
    state.session = { sub: "admin", iat: 0, exp: 1 };
    const response = await POST(
      request({ ...validFormV2, modes: [{ id: "docker", layer: "package/kernel" }] }),
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as { conflicts: { message: string }[] };
    expect(body.conflicts.map((conflict) => conflict.message).join("\n")).toMatch(/docker/);
    expect(body.conflicts.map((conflict) => conflict.message).join("\n")).toMatch(/source engine/);
  });
});
