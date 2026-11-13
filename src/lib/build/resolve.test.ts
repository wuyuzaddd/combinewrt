import { describe, expect, it } from "vitest";
import { resolveDependencies } from "./resolve";
import type { PackageLookup } from "./types";

const lookup: PackageLookup = (name) =>
  ({
    app: { version: "1", depends: ["lib", "libc|musl", "!bad"], source: "official" as const, sourcePin: "", sha256: null, filename: "app-1.apk", downloadUrl: null, feed: "packages" },
    lib: { version: "2", depends: ["libc"], source: "official" as const, sourcePin: "", sha256: null, filename: "lib-2.apk", downloadUrl: null, feed: "packages" },
    libc: { version: "3", depends: [], source: "official" as const, sourcePin: "", sha256: null, filename: "libc-3.apk", downloadUrl: null, feed: "packages" },
    musl: { version: "1", depends: [], source: "official" as const, sourcePin: "", sha256: null, filename: "musl-1.apk", downloadUrl: null, feed: "packages" },
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
    const sparse: PackageLookup = (name) =>
      name === "app"
        ? { version: "1", depends: ["ghost"], source: "official" as const, sourcePin: "", sha256: null, filename: "app-1.apk", downloadUrl: null, feed: "packages" }
        : null;
    const { missingDependencies } = resolveDependencies(["app"], sparse);
    expect(missingDependencies).toEqual(["ghost"]);
  });

  it("keeps unknown requested packages as free text", () => {
    const { entries } = resolveDependencies(["not-in-catalog"], lookup);
    expect(entries).toEqual([
      {
        name: "not-in-catalog",
        version: null,
        source: "selected",
        packageSource: null,
        sourcePin: null,
        sha256: null,
        feed: null,
        license: null,
        proprietary: false,
      },
    ]);
  });
});
