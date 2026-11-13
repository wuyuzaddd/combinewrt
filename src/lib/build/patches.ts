import type { AppliedPatch } from "./types";

/**
 * Patches applied by this repository on top of the pinned upstream sources.
 * The ImageBuilder workflow does not apply patches today, so the list is empty.
 * Any future OpenWrt-derived patch must be added here and kept in `patches/`
 * under GPL-2.0-only; the source-offer manifest reads this list verbatim.
 */
export const APPLIED_PATCHES: AppliedPatch[] = [];
