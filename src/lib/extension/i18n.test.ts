import { describe, expect, it } from "vitest";
import { i18nFallsBack, i18nLabel, i18nShortLabel, i18nStatusOf } from "./i18n";

describe("extension i18n metadata", () => {
  it("defaults an unlabelled package to unreviewed", () => {
    expect(i18nStatusOf({})).toBe("unreviewed");
    expect(i18nLabel({})).toBe("文案未校对");
    expect(i18nShortLabel({})).toBe("i18n 未校对");
    expect(i18nFallsBack({})).toBe(true);
  });

  it("labels the curated and auto statuses distinctly", () => {
    expect(i18nLabel({ i18n: { status: "curated" } })).toBe("文案已校对");
    expect(i18nLabel({ i18n: { status: "auto" } })).toBe("文案自动回退");
    expect(i18nShortLabel({ i18n: { status: "auto" } })).toBe("i18n 回退");
    expect(i18nFallsBack({ i18n: { status: "curated" } })).toBe(false);
    expect(i18nFallsBack({ i18n: { status: "auto" } })).toBe(true);
  });

  it("prefers the nested i18n status over the legacy accessor", () => {
    expect(i18nStatusOf({ i18n: { status: "curated" }, i18nStatus: "unreviewed" })).toBe("curated");
  });

  it("does not label a curated package as unreviewed", () => {
    const curated = { i18n: { status: "curated" as const, title: "已校对扩展" } };
    expect(i18nLabel(curated)).not.toContain("未校对");
    expect(i18nShortLabel(curated)).not.toContain("未校对");
    expect(i18nFallsBack(curated)).toBe(false);
  });
});
