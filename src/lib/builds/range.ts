/**
 * HTTP Range parsing for artifact downloads (ticket 14).
 *
 * Only single `bytes=` ranges are honoured. Multi-range and malformed headers
 * are treated as "no range" so the route serves the full artifact instead of
 * failing a download for a header we do not need to support.
 */

export type ParsedRange =
  | { kind: "none" }
  | { kind: "range"; start: number; end: number }
  | { kind: "unsatisfiable" };

const RANGE_PATTERN = /^bytes=(.*)$/i;

function digits(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

export function parseRangeHeader(header: string | null | undefined, size: number): ParsedRange {
  if (!header) return { kind: "none" };
  const match = RANGE_PATTERN.exec(header.trim());
  if (!match) return { kind: "none" };
  const spec = match[1].trim();
  if (!spec || spec.includes(",")) return { kind: "none" };

  const dash = spec.indexOf("-");
  if (dash < 0) return { kind: "none" };
  const rawStart = spec.slice(0, dash).trim();
  const rawEnd = spec.slice(dash + 1).trim();

  if (rawStart === "") {
    const suffix = digits(rawEnd);
    if (suffix === null) return { kind: "none" };
    if (suffix === 0 || size === 0) return { kind: "unsatisfiable" };
    const start = Math.max(0, size - suffix);
    return { kind: "range", start, end: size - 1 };
  }

  const start = digits(rawStart);
  if (start === null) return { kind: "none" };
  if (rawEnd === "") {
    if (size === 0 || start >= size) return { kind: "unsatisfiable" };
    return { kind: "range", start, end: size - 1 };
  }

  const end = digits(rawEnd);
  if (end === null) return { kind: "none" };
  if (start > end || start >= size) return { kind: "unsatisfiable" };
  return { kind: "range", start, end: Math.min(end, size - 1) };
}

/** `bytes 0-9/10`, or the unsatisfied `bytes *​/10` form. */
export function formatContentRange(start: number | null, end: number | null, size: number): string {
  if (start === null || end === null) return `bytes */${size}`;
  return `bytes ${start}-${end}/${size}`;
}
