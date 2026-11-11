import { describe, expect, it } from "vitest";
import { resolveDependencies } from "./resolve";
import type { PackageLookup } from "./types";

const lookup: PackageLookup = (name) =>
  ({
    app: { version: "1", depends: ["lib", "libc|musl", "!bad"] },
    lib: { version: "2", depends: ["libc"] },
    libc: { version: "3", depends: [] },
    musl: { version: "1", depends: [] },
  })[name] ?? null;

describe("resolveDependencies", () => {
  it("walks the dependency graph once", () => {
    const { entries } = resolveDependencies(["app"], lookup);
    expect(entries.map((entry) => `${entry.name}:${entry.source}`)).toEqual([
      "app:selected",
      "lib:dependency",
      "libc:dependency",
    ]);
  });

  it("picks the first available alternative", () => {
    const { entries } = resolveDependencies(["app"], lookup);
    expect(entries.map((entry) => entry.name)).toContain("libc");
    expect(entries.map((entry) => entry.name)).not.toContain("musl");
  });

  it("reports dependencies missing from the snapshot", () => {
    const sparse: PackageLookup = (name) => (name === "app" ? { version: "1", depends: ["ghost"] } : null);
    const { missingDependencies } = resolveDependencies(["app"], sparse);
    expect(missingDependencies).toEqual(["ghost"]);
  });

  it("keeps unknown requested packages as free text", () => {
    const { entries } = resolveDependencies(["not-in-catalog"], lookup);
    expect(entries).toEqual([{ name: "not-in-catalog", version: null, source: "selected" }]);
  });
});
