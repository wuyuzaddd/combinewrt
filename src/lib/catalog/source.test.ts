import { describe, expect, it } from "vitest";
import { parseBuildinfo } from "./source";

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
