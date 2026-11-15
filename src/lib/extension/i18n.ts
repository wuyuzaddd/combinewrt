import type { I18nStatus, SourceRegistryEntry } from "../sources/types";

/**
 * i18n review status of an extension package (ticket 12, ADR 0003).
 *
 * This is display metadata only. It never changes source admission, licence
 * compatibility, ABI checks or `publicAllowed`; the catalog labels the package
 * so a user knows whether the visible Chinese text was reviewed upstream, fell
 * back to another language, or was never reviewed at all.
 */
export const I18N_LABELS: Record<I18nStatus, string> = {
  curated: "文案已校对",
  auto: "文案自动回退",
  unreviewed: "文案未校对",
};

/** Short suffix used next to a package name in the catalog. */
export const I18N_SHORT_LABELS: Record<I18nStatus, string> = {
  curated: "i18n 校对",
  auto: "i18n 回退",
  unreviewed: "i18n 未校对",
};

/** Effective status of an entry: an absent status means "unreviewed". */
export function i18nStatusOf(entry: Pick<SourceRegistryEntry, "i18nStatus">): I18nStatus {
  return entry.i18nStatus ?? "unreviewed";
}

export function i18nLabel(entry: Pick<SourceRegistryEntry, "i18nStatus">): string {
  return I18N_LABELS[i18nStatusOf(entry)];
}

export function i18nShortLabel(entry: Pick<SourceRegistryEntry, "i18nStatus">): string {
  return I18N_SHORT_LABELS[i18nStatusOf(entry)];
}

/** True when the package falls back to unreviewed or automatically sourced text. */
export function i18nFallsBack(entry: Pick<SourceRegistryEntry, "i18nStatus">): boolean {
  return i18nStatusOf(entry) !== "curated";
}
