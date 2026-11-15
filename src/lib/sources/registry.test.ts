import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadSourceRegistry } from "./registry";

const dirs: string[] = [];

function tempRegistry(document: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "combinewrt-source-registry-"));
  dirs.push(dir);
  const path = join(dir, "registry.json");
  writeFileSync(path, JSON.stringify(document));
  return path;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const lucky = {
  name: "lucky",
  source: "dllkids",
  pin: "idx-sha",
  license: "GPL-2.0-only",
  publicAllowed: true,
  targets: ["x86/64"],
  kernelLines: ["6.12"],
  strategy: "prebuilt",
};

describe("source registry", () => {
  it("treats a missing registry file as empty so V1 catalog pins keep working", () => {
    const registry = loadSourceRegistry({ filePath: "/nonexistent/combinewrt/registry.json" });

    expect(registry.lookup("lucky")).toBeNull();
    expect(registry.lookup("luci", { source: "official" })).toBeNull();
  });

  it("reads the pin, SPDX, public flag, ranges and strategy of a record", () => {
    const path = tempRegistry({ schemaVersion: 1, packages: [lucky] });
    const registry = loadSourceRegistry({ filePath: path });

    expect(registry.lookup("lucky")).toEqual(lucky);
    expect(registry.lookup("lucky", { source: "dllkids" })).toEqual(lucky);
  });

  it("only returns the requested source layer when one is named", () => {
    const path = tempRegistry({
      schemaVersion: 1,
      packages: [lucky, { ...lucky, source: "official", pin: "" }],
    });
    const registry = loadSourceRegistry({ filePath: path });

    expect(registry.lookup("lucky", { source: "dllkids" })?.source).toBe("dllkids");
    expect(registry.lookup("lucky", { source: "official" })?.source).toBe("official");
    expect(registry.lookup("lucky", { source: "supplement" })).toBeNull();
  });

  it("rejects a malformed document with the path and the offending field", () => {
    const path = tempRegistry({ schemaVersion: 1, packages: [{ name: "lucky" }] });

    expect(() => loadSourceRegistry({ filePath: path })).toThrow(/source registry/i);
  });
});
