import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compareVersions, dedupePackages, parseAdbDump } from "./packages";
import type { CatalogPackage } from "./types";

const dump = readFileSync(new URL("./fixtures/base-excerpt.dump", import.meta.url), "utf8");

function pkg(name: string, version: string): CatalogPackage {
  return {
    name,
    version,
    arch: "x86_64",
    description: "",
    license: "GPL-2.0",
    origin: "feeds/base/utils/" + name,
    category: "utils",
    installedSize: 1,
    depends: [],
    feed: "base",
    proprietary: false,
  };
}

describe("parseAdbDump", () => {
  it("parses the real ImmortalWrt adbdump excerpt", () => {
    const packages = parseAdbDump(dump, "base");
    expect(packages.map((item) => item.name)).toEqual(["464xlat", "6in4", "6rd", "6to4", "adb"]);

    const xlat = packages.find((item) => item.name === "464xlat");
    expect(xlat).toMatchObject({
      version: "13",
      arch: "x86_64",
      license: "GPL-2.0",
      origin: "feeds/base/network/ipv6/464xlat",
      category: "network",
      installedSize: 14975,
      depends: ["ip", "kmod-nat46", "libc"],
      feed: "base",
      proprietary: false,
    });
    expect(xlat?.description).toContain("464xlat provides support");
  });

  it("flags packages without a license declaration", () => {
    const adb = parseAdbDump(dump, "base").find((item) => item.name === "adb");
    expect(adb?.license).toBeNull();
    expect(adb?.proprietary).toBe(true);
  });

  it("strips duplicated feed prefixes from origin", () => {
    const doubled = `packages: # 1 items
  - name: libupm
    version: 1
    description: |
      upm
    arch: x86_64
    license: MIT
    origin: feeds/packages/feeds/packages/libs/libupm
    installed-size: 10
    file-size: 10
    depends: # 0 items
`;
    expect(parseAdbDump(doubled, "packages")[0].category).toBe("libs");

    const single = doubled.replace("feeds/packages/feeds/packages/libs/libupm", "feeds/routing/babeld");
    expect(parseAdbDump(single, "routing")[0].category).toBe("routing");
  });

  it("handles an empty dump", () => {
    expect(parseAdbDump("packages: # 0 items\n", "base")).toEqual([]);
  });

  it("refuses a partial dump instead of saving a half-empty snapshot", () => {
    const truncated = dump.split("  - name: adb")[0];
    expect(() => parseAdbDump(truncated, "base")).toThrow(/partial|parsed/);
  });
});

describe("dedupePackages", () => {
  it("deduplicates across real feed excerpts", () => {
    const higher = readFileSync(new URL("./fixtures/higher-excerpt.dump", import.meta.url), "utf8");
    const merged = dedupePackages([...parseAdbDump(dump, "base"), ...parseAdbDump(higher, "packages")]);
    expect(merged).toHaveLength(5);
    expect(merged.find((item) => item.name === "6in4")?.version).toBe("99");
  });

  it("keeps the highest version of a duplicated name", () => {
    const result = dedupePackages([pkg("same", "13"), pkg("same", "14"), pkg("other", "1")]);
    expect(result.map((item) => `${item.name}@${item.version}`)).toEqual(["other@1", "same@14"]);
  });

  it("compares dotted versions numerically", () => {
    expect(compareVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.2.3-r2", "1.2.3-r1")).toBeGreaterThan(0);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });
});
