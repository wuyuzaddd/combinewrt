import { describe, expect, it } from "vitest";
import { validateBuildForm } from "./validate";

const valid = {
  profile: "generic",
  imageType: "ext4-efi",
  hostname: "router",
  timezone: "Asia/Shanghai",
  lanIp: "192.168.5.1",
  netmask: "255.255.255.0",
  rootPassword: "correct horse",
  packages: ["luci", " luci ", "luci"],
};

describe("validateBuildForm", () => {
  it("accepts an empty package list", () => {
    expect(validateBuildForm({ ...valid, packages: [] }).ok).toBe(true);
  });

  it("accepts a valid form and normalizes packages", () => {
    const result = validateBuildForm(valid);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.packages).toEqual(["luci"]);
  });

  it.each([
    ["hostname", "bad_host"],
    ["lanIp", "192.168.1.300"],
    ["netmask", "255.0.255.0"],
    ["timezone", "Mars/Olympus"],
    ["rootPassword", "short"],
    ["imageType", "vmdk"],
    ["packages", ["luci; rm -rf /"]],
    ["lanIp", "192.168.1.0"],
    ["rootPassword", "pass\nword"],
  ])("rejects an invalid %s", (field, value) => {
    const result = validateBuildForm({ ...valid, [field]: value });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.join("\n")).toMatch(new RegExp(field, "i"));
  });
});
