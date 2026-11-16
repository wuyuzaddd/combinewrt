import { describe, expect, it } from "vitest";
import { createSourceRegistry } from "../sources/registry";
import type { SourceRegistryEntry } from "../sources/types";
import { createExtensionCatalog } from "./catalog";
import { i18nFallsBack, i18nShortLabel } from "./i18n";
import type { ExtensionTheme } from "./types";

const curated: SourceRegistryEntry = {
  name: "luci-app-samba4",
  source: "extension",
  license: "Apache-2.0",
  publicAllowed: true,
  strategy: "rebuild",
  repo: "openwrt/luci",
  ref: "a".repeat(40),
  i18n: { status: "curated", title: "Samba 文件共享", description: "在路由器上共享 USB 存储。" },
};

const auto: SourceRegistryEntry = {
  name: "luci-app-mosdns",
  source: "extension",
  license: "GPL-3.0-only",
  publicAllowed: true,
  strategy: "rebuild",
  repo: "sbwml/luci-app-mosdns",
  ref: "b".repeat(40),
  i18n: { status: "auto", title: "MOSDNS 分流解析", description: "上游 README 的机器翻译版本。" },
};

const argon: SourceRegistryEntry = {
  name: "luci-theme-argon",
  source: "extension",
  license: "Apache-2.0",
  publicAllowed: true,
  strategy: "rebuild",
  repo: "jerrykuku/luci-theme-argon",
  ref: "c".repeat(40),
  i18n: { status: "curated", title: "Argon 主题（登记表）" },
};

const theme: ExtensionTheme = {
  package: "luci-theme-argon",
  title: "Argon",
  description: "深色玻璃质感主题。",
  preview: "/themes/argon.svg",
  luciVersions: ["25.12"],
  default: true,
};

const registry = createSourceRegistry([curated, auto, argon]);

function catalogWith(query = "") {
  return createExtensionCatalog({ registry, themes: [theme], bundles: [], query });
}

describe("extension catalog i18n labels", () => {
  it("uses curated registry titles and descriptions for non-theme packages", () => {
    const samba = catalogWith().packages.find((item) => item.name === "luci-app-samba4");

    expect(samba).toMatchObject({
      title: "Samba 文件共享",
      description: "在路由器上共享 USB 存储。",
      i18nStatus: "curated",
    });
    expect(i18nShortLabel(samba!)).toBe("i18n 校对");
    expect(i18nFallsBack(samba!)).toBe(false);
    expect(i18nShortLabel(samba!)).not.toBe("i18n 未校对");
  });

  it("keeps theme presentation metadata authoritative over the registry text", () => {
    const argonPackage = catalogWith().packages.find((item) => item.name === "luci-theme-argon");
    expect(argonPackage).toMatchObject({ title: "Argon", description: "深色玻璃质感主题。" });
  });

  it("still labels an auto package as falling back", () => {
    const mosdns = catalogWith().packages.find((item) => item.name === "luci-app-mosdns");
    expect(mosdns?.i18nStatus).toBe("auto");
    expect(i18nShortLabel(mosdns!)).toBe("i18n 回退");
  });

  it("matches curated display text when searching", () => {
    expect(catalogWith("USB 存储").packages.map((item) => item.name)).toEqual(["luci-app-samba4"]);
  });
});
