import { describe, expect, it } from "vitest";
import { generateUciDefaults, posixTimezone, shellQuote, themeMediaUrl } from "./uci";

const now = new Date("2026-11-11T00:00:00Z");

describe("posixTimezone", () => {
  it("handles UTC and fixed-offset zones", () => {
    expect(posixTimezone("UTC", now)).toBe("UTC0");
    expect(posixTimezone("Asia/Shanghai", now)).toBe("<+08>-08");
    expect(posixTimezone("Asia/Kolkata", now)).toBe("<+05>-05:30");
  });

  it("emits DST rules for northern and southern zones", () => {
    expect(posixTimezone("America/New_York", now)).toBe("<-05>+05<-04>+04,M3.2.0/2,M11.1.0/2");
    expect(posixTimezone("Europe/Berlin", now)).toBe("<+01>-01<+02>-02,M3.5.0/2,M10.5.0/2");
    expect(posixTimezone("Australia/Sydney", now)).toBe("<+10>-10<+11>-11,M10.1.0/2,M4.1.0/2");
  });
});

describe("generateUciDefaults", () => {
  it("writes hostname, timezone, LAN and the crypt hash only", () => {
    const file = generateUciDefaults(
      {
        hostname: "router",
        timezone: "Asia/Shanghai",
        lanIp: "192.168.5.1",
        netmask: "255.255.255.0",
      },
      "$6$salt$hash",
    );

    expect(file).toContain("uci set system.@system[0].hostname='router'");
    expect(file).toContain("uci set system.@system[0].timezone='<+08>-08'");
    expect(file).toContain("uci set network.lan.ipaddr='192.168.5.1'");
    expect(file).toContain("sed -i 's|^root:[^:]*|root:$6$salt$hash|' /etc/shadow");
    expect(file).not.toContain("correct horse");
    expect(file).not.toContain("mediaurlbase");
  });

  it("applies a selected default theme through the derived media URL", () => {
    const file = generateUciDefaults(
      {
        hostname: "router",
        timezone: "Asia/Shanghai",
        lanIp: "192.168.5.1",
        netmask: "255.255.255.0",
        theme: "luci-theme-argon",
      },
      "$6$salt$hash",
    );
    expect(file).toContain("uci set luci.main.mediaurlbase='/luci-static/argon'");
    expect(file).toContain("uci commit luci");
    // The raw package name never becomes a UCI line of its own.
    expect(file).not.toContain("uci set luci.main.mediaurlbase='luci-theme-argon'");
  });
});

describe("themeMediaUrl", () => {
  it("maps only well-formed luci-theme names", () => {
    expect(themeMediaUrl("luci-theme-argon")).toBe("/luci-static/argon");
    expect(themeMediaUrl("luci-theme-kucat")).toBe("/luci-static/kucat");
    expect(themeMediaUrl("luci-app-store")).toBeNull();
    expect(themeMediaUrl("luci-theme-argon'; rm -rf /")).toBeNull();
    expect(themeMediaUrl(null)).toBeNull();
  });
});

describe("shellQuote", () => {
  it("escapes single quotes", () => {
    expect(shellQuote("o'brien")).toBe("'o'\\''brien'");
  });
});
