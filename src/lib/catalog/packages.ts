import type { CatalogPackage, PackageSource } from "./types";
import { sourcePriority } from "./types";

const FIELD = /^    ([a-z][a-z0-9-]*):\s?(.*)$/;
const NEXT_PACKAGE = /^  - name: (.+)$/;

export function categoryFromOrigin(origin: string | null, feed: string): string {
  if (!origin) return feed;
  let parts = origin.split("/").filter(Boolean);
  // ImmortalWrt feed origins repeat the "feeds/<name>" prefix, e.g.
  // feeds/packages/feeds/packages/libs/libupm.
  while (parts[0] === "feeds" && parts.length >= 2) {
    parts = parts.slice(2);
  }
  // A single remaining segment is the package directory itself (common in
  // routing/telephony feeds), not a category.
  return parts.length >= 2 ? parts[0] : feed;
}

export function compareVersions(a: string, b: string): number {
  const left = a.split(/[._~+-]/);
  const right = b.split(/[._~+-]/);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const l = left[i] ?? "";
    const r = right[i] ?? "";
    const ln = Number.parseInt(l, 10);
    const rn = Number.parseInt(r, 10);
    if (Number.isFinite(ln) && Number.isFinite(rn) && ln !== rn) return ln - rn;
    if (l !== r) return l.localeCompare(r);
  }
  return 0;
}

export interface ParseAdbOptions {
  source?: PackageSource;
  sourcePin?: string;
  downloadBase?: string | null;
}

export function parseAdbDump(dump: string, feed: string, options: ParseAdbOptions = {}): CatalogPackage[] {
  const source = options.source ?? "official";
  const sourcePin = options.sourcePin ?? "";
  const downloadBase = options.downloadBase ?? null;
  const lines = dump.split(/\r?\n/);
  const packages: CatalogPackage[] = [];
  let i = 0;

  while (i < lines.length && !/^packages:/.test(lines[i])) i += 1;
  if (i === lines.length) throw new Error(`adb dump for ${feed} has no packages header`);
  const header = /^packages: # (\d+) items$/.exec(lines[i]);
  i += 1;

  while (i < lines.length) {
    const start = NEXT_PACKAGE.exec(lines[i]);
    if (!start) {
      i += 1;
      continue;
    }

    const name = start[1].trim();
    let version = "";
    let arch = "";
    let description = "";
    let license: string | null = null;
    let origin: string | null = null;
    let installedSize = 0;
    let fileSize = 0;
    let sha256: string | null = null;
    let depends: string[] = [];
    i += 1;

    while (i < lines.length && !NEXT_PACKAGE.test(lines[i])) {
      const field = FIELD.exec(lines[i]);
      if (!field) {
        i += 1;
        continue;
      }

      const key = field[1];
      const value = field[2].trim();

      if (key === "description") {
        if (value === "|" || value === "") {
          const parts: string[] = [];
          i += 1;
          while (i < lines.length) {
            if (lines[i].startsWith("      ")) {
              parts.push(lines[i].slice(6));
              i += 1;
            } else if (lines[i] === "" && lines[i + 1]?.startsWith("      ")) {
              parts.push("");
              i += 1;
            } else {
              break;
            }
          }
          description = parts.join("\n").trim();
        } else {
          description = value;
          i += 1;
        }
        continue;
      }

      if (key === "depends") {
        const items: string[] = [];
        i += 1;
        while (i < lines.length && /^      - (.+)$/.test(lines[i])) {
          items.push(lines[i].replace(/^      - /, "").trim());
          i += 1;
        }
        depends = items;
        continue;
      }

      i += 1;
      if (key === "version") version = value;
      else if (key === "arch") arch = value;
      else if (key === "license") license = value || null;
      else if (key === "origin") origin = value || null;
      else if (key === "installed-size") installedSize = Number(value) || 0;
      else if (key === "file-size") fileSize = Number(value) || 0;
      else if (key === "hashes") sha256 = /^[0-9a-f]{64}$/.exec(value)?.[0] ?? null;
    }

    const filename = version ? `${name}-${version}.apk` : null;
    packages.push({
      name,
      version,
      arch,
      description,
      license,
      origin,
      category: categoryFromOrigin(origin, feed),
      installedSize,
      depends,
      feed,
      proprietary: !license || /proprietary/i.test(license),
      source,
      sourcePin,
      sha256,
      fileSize,
      filename,
      downloadUrl: filename && downloadBase ? `${downloadBase.replace(/\/$/, "")}/${encodeURIComponent(filename)}` : null,
      kmod: name.startsWith("kmod-"),
    });
  }

  if (header) {
    const expected = Number(header[1]);
    if (packages.length !== expected) {
      throw new Error(`parsed ${packages.length} of ${expected} packages from ${feed} dump; refusing a partial snapshot`);
    }
  }

  return packages;
}

export function comparePackageSource(a: CatalogPackage, b: CatalogPackage): number {
  return sourcePriority(a.source) - sourcePriority(b.source) || a.name.localeCompare(b.name);
}

export function preferredPackage(packages: CatalogPackage[]): CatalogPackage | null {
  return [...packages].sort(comparePackageSource)[0] ?? null;
}

export function dedupePackages(packages: CatalogPackage[]): CatalogPackage[] {
  const byName = new Map<string, CatalogPackage>();
  for (const pkg of packages) {
    const key = `${pkg.source}:${pkg.name}`;
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, pkg);
      continue;
    }
    if (compareVersions(pkg.version, existing.version) > 0) {
      byName.set(key, pkg);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name) || sourcePriority(a.source) - sourcePriority(b.source));
}
