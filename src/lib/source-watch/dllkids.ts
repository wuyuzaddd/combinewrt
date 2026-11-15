import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareVersions, parseAdbDump, type ParseAdbOptions } from "../catalog/packages";
import type { CatalogPackage } from "../catalog/types";
import { createHttpRepoRefWatcher, sha256Hex } from "./observe";
import type { PackageFingerprint, RepoRefWatcher } from "./types";

export interface DllkidsIndexSnapshot {
  packageCount: number;
  packages: PackageFingerprint[];
}

export interface DllkidsRepoRefWatcherOptions {
  baseUrl: string;
  apkBin?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  /** Injectable `apk adbdump` seam; tests return fixture dumps. */
  runAdbDump?: (bytes: Buffer) => Promise<string>;
}

export function dllkidsIndexUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/packages.adb`;
}

/**
 * Collapse a parsed feed to one fingerprint per package name (highest version
 * wins). Diffs compare package identities, not repeated rows in one index.
 */
export function fingerprintPackages(packages: CatalogPackage[]): PackageFingerprint[] {
  const byName = new Map<string, PackageFingerprint>();
  for (const pkg of packages) {
    const existing = byName.get(pkg.name);
    if (!existing || compareVersions(pkg.version, existing.version) > 0) {
      byName.set(pkg.name, { name: pkg.name, version: pkg.version, sha256: pkg.sha256 });
    }
  }
  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function dumpAdb(apkBin: string, file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      apkBin,
      ["adbdump", file],
      { maxBuffer: 64 * 1024 * 1024, encoding: "utf8" },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      },
    );
  });
}

export async function dumpAdbBytes(apkBin: string, bytes: Buffer): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "combinewrt-watch-"));
  try {
    const file = join(dir, "packages.adb");
    await writeFile(file, bytes);
    return await dumpAdb(apkBin, file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Parse an already-downloaded dllkids index into package fingerprints. A
 * partial dump (declared item count != parsed count) throws; callers must not
 * adopt the result.
 */
export async function parseDllkidsIndex(
  bytes: Buffer,
  run: (bytes: Buffer) => Promise<string>,
  options: ParseAdbOptions = {},
): Promise<DllkidsIndexSnapshot> {
  const pin = sha256Hex(bytes);
  const dump = await run(bytes);
  const packages = parseAdbDump(dump, "dllkids", {
    ...options,
    source: "dllkids",
    sourcePin: pin,
  });
  return { packageCount: packages.length, packages: fingerprintPackages(packages) };
}

/**
 * dllkids source watch: `packages.adb` identified by its sha256. The index is
 * unsigned (accepted risk, ADR 0008); the watch only protects integrity and
 * version drift, it does not add a signature check.
 */
export function createDllkidsRepoRefWatcher(
  options: DllkidsRepoRefWatcherOptions,
): RepoRefWatcher<DllkidsIndexSnapshot> {
  const apkBin = options.apkBin ?? "apk";
  const run = options.runAdbDump ?? ((bytes: Buffer) => dumpAdbBytes(apkBin, bytes));
  return createHttpRepoRefWatcher<DllkidsIndexSnapshot>({
    source: "dllkids",
    ref: dllkidsIndexUrl(options.baseUrl),
    fetchImpl: options.fetchImpl,
    now: options.now,
    parse: (bytes) => parseDllkidsIndex(bytes, run),
  });
}
