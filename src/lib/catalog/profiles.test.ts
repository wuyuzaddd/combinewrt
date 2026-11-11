import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseProfiles } from "./profiles";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/profiles-x86-64.json", import.meta.url), "utf8"),
) as unknown;

describe("parseProfiles", () => {
  it("keeps x86_64 profiles and maps supported image formats", () => {
    const profiles = parseProfiles(fixture);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({
      id: "generic",
      title: "Generic x86/64",
      formats: ["ext4-efi", "squashfs-efi", "rootfs-tar"],
      imageCount: 25,
    });
  });

  it("rejects a profiles.json for another architecture", () => {
    expect(() => parseProfiles({ arch_packages: "aarch64_generic", profiles: {} })).toThrow(/x86_64/);
  });

  it("rejects input without profiles", () => {
    expect(() => parseProfiles({ arch_packages: "x86_64" })).toThrow(/no profiles/);
  });

  it("rejects an empty profiles object", () => {
    expect(() => parseProfiles({ arch_packages: "x86_64", profiles: {} })).toThrow(/no profiles/);
  });
});
