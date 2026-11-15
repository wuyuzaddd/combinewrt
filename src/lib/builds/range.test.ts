import { describe, expect, it } from "vitest";
import { formatContentRange, parseRangeHeader } from "./range";

describe("parseRangeHeader", () => {
  it("returns none without a usable range header", () => {
    expect(parseRangeHeader(null, 10)).toEqual({ kind: "none" });
    expect(parseRangeHeader("", 10)).toEqual({ kind: "none" });
    expect(parseRangeHeader("items=0-1", 10)).toEqual({ kind: "none" });
    expect(parseRangeHeader("bytes=abc", 10)).toEqual({ kind: "none" });
    expect(parseRangeHeader("bytes=0-1,4-5", 10)).toEqual({ kind: "none" });
  });

  it("parses bounded, open and suffix ranges", () => {
    expect(parseRangeHeader("bytes=0-0", 10)).toEqual({ kind: "range", start: 0, end: 0 });
    expect(parseRangeHeader("bytes=2-5", 10)).toEqual({ kind: "range", start: 2, end: 5 });
    expect(parseRangeHeader("bytes=5-", 10)).toEqual({ kind: "range", start: 5, end: 9 });
    expect(parseRangeHeader("bytes=-4", 10)).toEqual({ kind: "range", start: 6, end: 9 });
    expect(parseRangeHeader("bytes=-100", 10)).toEqual({ kind: "range", start: 0, end: 9 });
  });

  it("clamps the end to the artifact size", () => {
    expect(parseRangeHeader("bytes=0-100", 10)).toEqual({ kind: "range", start: 0, end: 9 });
  });

  it("reports unsatisfiable ranges", () => {
    expect(parseRangeHeader("bytes=10-", 10)).toEqual({ kind: "unsatisfiable" });
    expect(parseRangeHeader("bytes=5-2", 10)).toEqual({ kind: "unsatisfiable" });
    expect(parseRangeHeader("bytes=-0", 10)).toEqual({ kind: "unsatisfiable" });
    expect(parseRangeHeader("bytes=0-", 0)).toEqual({ kind: "unsatisfiable" });
  });
});

describe("formatContentRange", () => {
  it("renders a 206 content range", () => {
    expect(formatContentRange(0, 9, 10)).toBe("bytes 0-9/10");
  });

  it("renders the unsatisfied form", () => {
    expect(formatContentRange(null, null, 10)).toBe("bytes */10");
  });
});
