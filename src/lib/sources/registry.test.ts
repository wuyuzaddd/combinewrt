import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadSourceRegistry, validateSourceRegistryDocument } from "./registry";

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
  i18n: { status: "curated", title: "Lucky 工具" },
};

function violationText(document: unknown): string {
  return validateSourceRegistryDocument(document)
    .violations.map((item) => `${item.path}: ${item.message}`)
    .join("\n");
}

describe("source registry", () => {
  it("treats a missing registry file as empty so V1 catalog pins keep working", () => {
    const registry = loadSourceRegistry({ filePath: "/nonexistent/combinewrt/registry.json" });

    expect(registry.lookup("lucky")).toBeNull();
    expect(registry.lookup("luci", { source: "official" })).toBeNull();
  });

  it("reads the pin, SPDX, public flag, ranges and strategy of a record", () => {
    const path = tempRegistry({ schemaVersion: 1, packages: [lucky] });
    const registry = loadSourceRegistry({ filePath: path });

    expect(registry.lookup("lucky")).toMatchObject(lucky);
    expect(registry.lookup("lucky", { source: "dllkids" })).toMatchObject(lucky);
    expect(registry.lookup("lucky")?.i18nStatus).toBe("curated");
  });

  it("maps the nested i18n object to every status the catalog renders", () => {
    const path = tempRegistry({
      schemaVersion: 1,
      packages: [
        {
          ...lucky,
          name: "curated-pkg",
          i18n: { status: "curated", title: "校对包", description: "已人工校对的说明" },
        },
        { ...lucky, name: "auto-pkg", i18n: { status: "auto", title: "自动包" } },
        { ...lucky, name: "unreviewed-pkg", i18n: { status: "unreviewed", title: "未校对包" } },
      ],
    });
    const registry = loadSourceRegistry({ filePath: path });

    expect(registry.lookup("curated-pkg")).toMatchObject({
      i18n: { status: "curated", title: "校对包", description: "已人工校对的说明" },
      i18nStatus: "curated",
    });
    expect(registry.lookup("auto-pkg")).toMatchObject({
      i18n: { status: "auto", title: "自动包" },
      i18nStatus: "auto",
    });
    expect(registry.lookup("unreviewed-pkg")).toMatchObject({
      i18n: { status: "unreviewed", title: "未校对包" },
      i18nStatus: "unreviewed",
    });
  });

  it("rejects an absent i18n object and an unknown i18n.status", () => {
    const missing = { ...lucky } as Record<string, unknown>;
    delete missing.i18n;
    expect(violationText({ packages: [missing] })).toMatch(/i18n is required/);

    expect(violationText({ packages: [{ ...lucky, i18n: { status: "reviewed" } }] })).toMatch(
      /i18n\.status must be one of curated, auto, unreviewed/,
    );
    expect(violationText({ packages: [{ ...lucky, i18n: { status: "" } }] })).toMatch(/i18n\.status/);
    expect(violationText({ packages: [{ ...lucky, i18n: "curated" }] })).toMatch(/i18n must be an object/);
  });

  it("rejects empty curated display text and the legacy top-level i18nStatus", () => {
    expect(violationText({ packages: [{ ...lucky, i18n: { status: "curated", title: " " } }] })).toMatch(
      /i18n\.title must be a non-empty string/,
    );
    expect(violationText({ packages: [{ ...lucky, i18n: { status: "curated", description: 1 } }] })).toMatch(
      /i18n\.description must be a non-empty string/,
    );
    expect(violationText({ packages: [{ ...lucky, i18nStatus: "curated" }] })).toMatch(
      /i18nStatus is not supported at the top level/,
    );
  });

  it("keeps i18n metadata errors independent of admission checks", () => {
    const text = violationText({
      packages: [{ ...lucky, license: "WTFPL", i18n: { status: "bogus" } }],
    });
    expect(text).toMatch(/i18n\.status/);
    expect(text).toMatch(/not a reviewed SPDX identifier/);
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
