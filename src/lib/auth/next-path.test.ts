import { describe, expect, it } from "vitest";
import { safeNextPath } from "./next-path";

describe("safeNextPath", () => {
  it("keeps local paths", () => {
    expect(safeNextPath("/admin")).toBe("/admin");
    expect(safeNextPath("/admin/builds?page=2")).toBe("/admin/builds?page=2");
  });

  it("defaults when missing", () => {
    expect(safeNextPath(undefined)).toBe("/admin");
    expect(safeNextPath("")).toBe("/admin");
  });

  it("rejects absolute and protocol-relative targets", () => {
    expect(safeNextPath("https://evil.example")).toBe("/admin");
    expect(safeNextPath("//evil.example")).toBe("/admin");
  });

  it("rejects backslash smuggling", () => {
    expect(safeNextPath("/\\evil.example")).toBe("/admin");
  });
});
