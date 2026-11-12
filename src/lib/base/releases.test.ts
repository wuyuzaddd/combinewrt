import { describe, expect, it } from "vitest";
import {
  compareVersions,
  fetchReleaseCandidate,
  imageBuilderUrl,
  latestRelease,
  parseImageBuilderSha256,
  parseReleaseIndex,
} from "./releases";

const INDEX = `
<table>
  <tr><td class="n"><a href="25.12-SNAPSHOT/">25.12-SNAPSHOT</a>/</td><td class="s">-</td><td class="d">Thu Oct 29 04:00:14 2026</td></tr>
  <tr><td class="n"><a href="25.12.1/">25.12.1</a>/</td><td class="s">-</td><td class="d">Tue Jul  7 16:00:07 2026</td></tr>
  <tr><td class="n"><a href="25.12.2/">25.12.2</a>/</td><td class="s">-</td><td class="d">Tue Sep  8 21:42:22 2026</td></tr>
  <tr><td class="n"><a href="24.10.6/">24.10.6</a>/</td><td class="s">-</td><td class="d">Mon Apr 27 03:19:04 2026</td></tr>
</table>`;

describe("release parsing", () => {
  it("keeps stable releases and ignores snapshots", () => {
    const releases = parseReleaseIndex(INDEX);
    expect(releases.map((release) => release.version)).toEqual(["25.12.1", "25.12.2", "24.10.6"]);
    expect(releases[1].releaseDate).toBe("2026-09-08");
  });

  it("orders versions numerically", () => {
    expect(compareVersions("25.12.10", "25.12.2")).toBeGreaterThan(0);
    expect(compareVersions("25.12.2", "25.12.2")).toBe(0);
    expect(latestRelease(parseReleaseIndex(INDEX))?.version).toBe("25.12.2");
  });

  it("builds the ImageBuilder URL", () => {
    expect(imageBuilderUrl("25.12.2")).toBe(
      "https://downloads.immortalwrt.org/releases/25.12.2/targets/x86/64/immortalwrt-imagebuilder-25.12.2-x86-64.Linux-x86_64.tar.zst",
    );
  });

  it("extracts the ImageBuilder checksum", () => {
    const sums = [
      "aaaa *immortalwrt-25.12.2-x86-64-generic-ext4-combined-efi.img.gz",
      "b9b290f5ef60a22bccd5bdca9c1e7523b8fc84e60462afbf550e20db94acf2c6 *immortalwrt-imagebuilder-25.12.2-x86-64.Linux-x86_64.tar.zst",
    ].join("\n");
    expect(parseImageBuilderSha256(sums, "25.12.2")).toBe(
      "b9b290f5ef60a22bccd5bdca9c1e7523b8fc84e60462afbf550e20db94acf2c6",
    );
    expect(parseImageBuilderSha256(sums, "25.12.3")).toBeNull();
  });

  it("fetches a candidate with its checksum", async () => {
    const fetchImpl = (async () =>
      new Response(
        "b9b290f5ef60a22bccd5bdca9c1e7523b8fc84e60462afbf550e20db94acf2c6 *immortalwrt-imagebuilder-25.12.3-x86-64.Linux-x86_64.tar.zst",
      )) as typeof fetch;
    const candidate = await fetchReleaseCandidate("25.12.3", "2026-10-01", fetchImpl);
    expect(candidate.imageBuilderSha256).toBe(
      "b9b290f5ef60a22bccd5bdca9c1e7523b8fc84e60462afbf550e20db94acf2c6",
    );
    expect(candidate.imageBuilderUrl).toContain("25.12.3");
  });
});
