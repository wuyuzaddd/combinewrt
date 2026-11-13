import { describe, expect, it } from "vitest";
import { composeFeedCommit, createImmortalWrtSource, parseBuildinfo, parseBuildinfoEntries } from "./source";

const sample = [
  "src-git packages https://github.com/immortalwrt/packages.git^84bd86384928955b568988ca0e09e2c78c75173d",
  "src-git luci https://github.com/immortalwrt/luci.git^d6167ea0645cbd1327708d85f94824f42d0eb872",
  "src-git routing https://github.com/openwrt/routing.git^e49d76035aafb85ddc993b59271d8c7ba56b5362",
  "src-git telephony https://github.com/openwrt/telephony.git^2618106d5846a4a542fdf5809f0d3ed228ce439b",
].join("\n");

describe("parseBuildinfo", () => {
  it("derives a stable 16-hex feed commit", () => {
    const commit = parseBuildinfo(sample);
    expect(commit).toMatch(/^[0-9a-f]{16}$/);
    expect(parseBuildinfo(sample)).toBe(commit);
  });

  it("changes when any feed commit changes", () => {
    expect(parseBuildinfo(sample.replace("84bd8638", "94bd8638"))).not.toBe(parseBuildinfo(sample));
  });

  it("rejects unexpected lines and empty input", () => {
    expect(() => parseBuildinfo("garbage")).toThrow(/unexpected/);
    expect(() => parseBuildinfo("")).toThrow(/empty/);
  });
});

describe("parseBuildinfoEntries", () => {
  it("returns the official feed commits keyed by feed", () => {
    const entries = parseBuildinfoEntries(sample);
    expect(entries).toEqual([
      { feed: "luci", commit: "d6167ea0645cbd1327708d85f94824f42d0eb872" },
      { feed: "packages", commit: "84bd86384928955b568988ca0e09e2c78c75173d" },
      { feed: "routing", commit: "e49d76035aafb85ddc993b59271d8c7ba56b5362" },
      { feed: "telephony", commit: "2618106d5846a4a542fdf5809f0d3ed228ce439b" },
    ]);
  });
});

describe("composeFeedCommit", () => {
  it("changes when a third-party pin changes", () => {
    const base = composeFeedCommit({
      official: { packages: "a".repeat(40) },
      dllkids: "b".repeat(64),
      supplement: null,
      kernel: null,
    });
    const changed = composeFeedCommit({
      official: { packages: "a".repeat(40) },
      dllkids: "c".repeat(64),
      supplement: null,
      kernel: null,
    });
    expect(base).toMatch(/^[0-9a-f]{16}$/);
    expect(changed).not.toBe(base);
  });
});

describe("createImmortalWrtSource supplement feed", () => {
  it("rejects a supplement key whose sha256 does not match the configured fingerprint", async () => {
    const responses: Record<string, string> = {
      "profiles.json": JSON.stringify({
        linux_kernel: { version: "6.12.103", release: "1", vermagic: "0413601b1c3f0490e17f340fe09229ea" },
      }),
      "feeds.buildinfo": sample,
      "packages.adb": "supplement index",
      "combinewrt-feed.pub.pem": "unexpected key",
    };
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      const key = Object.keys(responses).find((suffix) => url.endsWith(suffix));
      if (!key) return new Response("missing", { status: 404 });
      return new Response(responses[key], { status: 200 });
    }) as typeof fetch;

    const source = createImmortalWrtSource({
      baseVersion: "25.12.2",
      fetchImpl,
      supplementFeed: {
        baseUrl: "https://example.invalid/supplement/x86_64",
        keyUrl: "https://example.invalid/supplement/keys/combinewrt-feed.pub.pem",
        keyFingerprint: "0".repeat(64),
      },
    });
    await expect(source.loadMeta()).rejects.toThrow(/supplement feed key sha256 mismatch/);
  });
});

describe("createImmortalWrtSource dllkids index", () => {
  it("rejects an index whose sha256 does not match the configured pin", async () => {
    const responses: Record<string, string> = {
      "profiles.json": JSON.stringify({
        linux_kernel: { version: "6.12.103", release: "1", vermagic: "0413601b1c3f0490e17f340fe09229ea" },
      }),
      "feeds.buildinfo": sample,
      "packages.adb": "not the pinned index",
    };
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      const key = Object.keys(responses).find((suffix) => url.endsWith(suffix));
      if (!key) return new Response("missing", { status: 404 });
      return new Response(responses[key], { status: 200 });
    }) as typeof fetch;

    const source = createImmortalWrtSource({
      baseVersion: "25.12.2",
      fetchImpl,
      dllkids: { baseUrl: "https://down.dllkids.xyz/openwrt-feed/25.12/x86_64/", indexSha256: "0".repeat(64) },
    });
    await expect(source.loadMeta()).rejects.toThrow(/dllkids packages\.adb sha256 mismatch/);
  });
});
