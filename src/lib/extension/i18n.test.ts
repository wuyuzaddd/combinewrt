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
    expect(i18nLabel({ i18nStatus: "curated" })).toBe("文案已校对");
    expect(i18nLabel({ i18nStatus: "auto" })).toBe("文案自动回退");
    expect(i18nShortLabel({ i18nStatus: "auto" })).toBe("i18n 回退");
    expect(i18nFallsBack({ i18nStatus: "curated" })).toBe(false);
    expect(i18nFallsBack({ i18nStatus: "auto" })).toBe(true);
  });
});
