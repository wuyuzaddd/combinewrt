import { describe, expect, it } from "vitest";
import { createSourceRegistry } from "../sources/registry";
import type { SourceRegistryEntry } from "../sources/types";
import { checkDependencyClosure } from "./closure";
import type { PackageLookup, PackageLookupEntry, ResolvedEntry } from "./types";

function entry(name: string, overrides: Partial<PackageLookupEntry> = {}): PackageLookupEntry {
  return {
    version: "1",
    depends: [],
    source: "official",
    sourcePin: "",
    sha256: null,
    filename: `${name}-1.apk`,
    downloadUrl: null,
    feed: "packages",
    ...overrides,
  };
}

function resolved(name: string, packageSource: ResolvedEntry["packageSource"] = "official"): ResolvedEntry {
  return { name, version: "1", source: "selected", packageSource, sourcePin: null, sha256: null, feed: null };
}

function registry(entries: Partial<SourceRegistryEntry>[] = []): ReturnType<typeof createSourceRegistry> {
  return createSourceRegistry(
    entries.map((overrides) => ({
      name: "ghost",
      source: "official",
      pin: "releases/25.12.2",
      license: "MIT",
      publicAllowed: true,
      strategy: "prebuilt",
      ...overrides,
    })) as SourceRegistryEntry[],
  );
}

describe("catalogue-level dependency closure", () => {
  it("accepts a closure whose dependencies are selected or resolvable", () => {
    const lookup: PackageLookup = (name) => {
      if (name === "app") return entry("app", { depends: ["lib", "libc|musl", "!bad", "so:libc.so.6", "lib>=1"] });
      if (name === "lib") return entry("lib", { depends: ["libc"] });
      if (name === "libc") return entry("libc");
      return null;
    };

    const result = checkDependencyClosure({
      entries: [resolved("app"), resolved("lib"), resolved("libc")],
      lookup,
      sources: registry(),
    });

    expect(result.conflicts).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("raises a 409-grade conflict naming package, dependency and source when the snapshot can decide", () => {
    const lookup: PackageLookup = (name) => (name === "app" ? entry("app", { depends: ["ghost"] }) : null);

    const result = checkDependencyClosure({
      entries: [resolved("app")],
      lookup,
      sources: registry([{ name: "ghost", source: "official" }]),
    });

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.names).toEqual(["app", "ghost"]);
    const message = result.conflicts[0]?.message ?? "";
    expect(message).toContain("Package \"app\" (official)");
    expect(message).toContain("\"ghost\" (official)");
    expect(message).toContain("workflow preflight remains authoritative");
    expect(result.warnings).toEqual([]);
  });

  it("keeps a dependency the registry does not know as a warning, never a false 409", () => {
    const lookup: PackageLookup = (name) => (name === "app" ? entry("app", { depends: ["mystery"] }) : null);

    const result = checkDependencyClosure({
      entries: [resolved("app")],
      lookup,
      sources: registry(),
    });

    expect(result.conflicts).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("Package \"app\" (official)");
    expect(result.warnings[0]).toContain("\"mystery\"");
    expect(result.warnings[0]).toContain("workflow preflight remains authoritative");
  });

  it("keeps unknowns as warnings when the snapshot cannot decide the plan (extension entry present)", () => {
    const lookup: PackageLookup = (name) => (name === "app" ? entry("app", { depends: ["ghost"] }) : null);

    const result = checkDependencyClosure({
      entries: [resolved("app"), resolved("theme", "extension")],
      lookup,
      sources: registry([{ name: "ghost", source: "official" }]),
    });

    expect(result.conflicts).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("\"ghost\"");
  });

  it("does not double-report a dependency shared by several packages", () => {
    const lookup: PackageLookup = (name) => {
      if (name === "a") return entry("a", { depends: ["ghost"] });
      if (name === "b") return entry("b", { depends: ["ghost"] });
      return null;
    };

    const result = checkDependencyClosure({
      entries: [resolved("a"), resolved("b")],
      lookup,
      sources: registry([{ name: "ghost", source: "official" }]),
    });

    expect(result.conflicts).toHaveLength(2);
    expect(new Set(result.conflicts.map((conflict) => conflict.names.join(">")) ).size).toBe(2);
  });

  it("treats a virtual dependency as satisfied when its provider is in the plan", () => {
    const lookup: PackageLookup = (name) => {
      if (name === "app") return entry("app", { depends: ["ip"] });
      if (name === "ip-full") return entry("ip-full");
      return null;
    };
    const result = checkDependencyClosure({
      entries: [resolved("app"), resolved("ip-full")],
      lookup,
      sources: registry(),
      virtuals: (name) => (name === "ip" ? ["ip-full", "ip-tiny"] : []),
    });
    expect(result.conflicts).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("keeps the warning when a virtual name has no provider either", () => {
    const lookup: PackageLookup = (name) => (name === "app" ? entry("app", { depends: ["linkease-app-entry"] }) : null);
    const result = checkDependencyClosure({
      entries: [resolved("app")],
      lookup,
      sources: registry(),
      virtuals: () => [],
    });
    expect(result.warnings).toHaveLength(1);
  });
});
