import { describe, expect, it } from "vitest";
import { createHttpRepoRefWatcher, sha256Hex } from "./observe";

describe("repository ref watcher seam", () => {
  it("derives the pin from bytes and parses fully", async () => {
    const bytes = Buffer.from("index-bytes");
    const watcher = createHttpRepoRefWatcher({
      source: "supplement",
      ref: "https://feed.test/packages.adb",
      fetchImpl: (async () => new Response(new Uint8Array(bytes))) as typeof fetch,
      now: () => new Date("2026-11-15T00:00:00.000Z"),
      parse: async (input) => ({ size: input.length }),
    });

    const observation = await watcher.observe();
    expect(observation).toMatchObject({
      source: "supplement",
      ref: "https://feed.test/packages.adb",
      observedAt: "2026-11-15T00:00:00.000Z",
      pin: sha256Hex(bytes),
      error: null,
    });
    expect(observation.bytes?.equals(bytes)).toBe(true);
    expect(observation.parsed).toEqual({ size: bytes.length });
  });

  it("can identify a git commit instead of the byte hash", async () => {
    const watcher = createHttpRepoRefWatcher({
      source: "extension",
      ref: "https://git.test/repo",
      fetchImpl: (async () => new Response("body")) as typeof fetch,
      identify: () => "d".repeat(40),
      parse: async () => null,
    });
    expect((await watcher.observe()).pin).toBe("d".repeat(40));
  });

  it("turns an upstream failure into an error observation", async () => {
    const watcher = createHttpRepoRefWatcher({
      source: "dllkids",
      ref: "https://feed.test/packages.adb",
      fetchImpl: (async () => new Response("nope", { status: 503 })) as typeof fetch,
      parse: async () => null,
    });
    const observation = await watcher.observe();
    expect(observation.error).toContain("503");
    expect(observation.pin).toBeNull();
  });

  it("rejects a partial parse without throwing out of observe()", async () => {
    const watcher = createHttpRepoRefWatcher<null>({
      source: "dllkids",
      ref: "https://feed.test/packages.adb",
      fetchImpl: (async () => new Response("body")) as typeof fetch,
      parse: async () => {
        throw new Error("parsed 1 of 3 packages; refusing a partial snapshot");
      },
    });
    const observation = await watcher.observe();
    expect(observation.error).toContain("refusing a partial snapshot");
    expect(observation.parsed).toBeNull();
  });

  it("collapses concurrent observers into one fetch", async () => {
    let fetches = 0;
    const watcher = createHttpRepoRefWatcher({
      source: "dllkids",
      ref: "https://feed.test/packages.adb",
      fetchImpl: (async () => {
        fetches += 1;
        return new Response("body");
      }) as typeof fetch,
      parse: async () => null,
    });
    await Promise.all([watcher.observe(), watcher.observe()]);
    expect(fetches).toBe(1);
  });
});
