/**
 * SPDX identifiers the source registry accepts.
 *
 * The list is deliberately short: it is the set of licences the V2 license gate
 * can reason about (ADR 0003). Anything else must be reviewed and added here
 * explicitly, which is what makes "unknown SPDX id" a registry validation error.
 */
export const SPDX_IDS = [
  "0BSD",
  "AGPL-3.0-only",
  "AGPL-3.0-or-later",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "CC0-1.0",
  "GPL-2.0-only",
  "GPL-2.0-or-later",
  "GPL-3.0-only",
  "GPL-3.0-or-later",
  "ISC",
  "LGPL-2.1-only",
  "LGPL-2.1-or-later",
  "LGPL-3.0-only",
  "LGPL-3.0-or-later",
  "MIT",
  "MPL-2.0",
  "Unlicense",
] as const;

export type SpdxId = (typeof SPDX_IDS)[number];

const SPDX_SET: ReadonlySet<string> = new Set(SPDX_IDS);

/** True when `value` is one of the reviewed SPDX identifiers. */
export function isSpdxId(value: unknown): value is SpdxId {
  return typeof value === "string" && SPDX_SET.has(value);
}
