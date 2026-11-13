import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CatalogSource } from "./service";
import type { KernelPin, SourcePins, SupplementPin } from "./types";

const RELEASE_ROOT = "https://downloads.immortalwrt.org/releases";

export interface DllkidsSourceOptions {
  baseUrl: string;
  indexSha256: string;
}

export interface SupplementFeedOptions {
  baseUrl: string;
  keyUrl: string;
  keyFingerprint: string;
}

export interface ImmortalWrtSourceOptions {
  baseVersion: string;
  apkBin?: string;
  fetchImpl?: typeof fetch;
  dllkids?: DllkidsSourceOptions | null;
  supplement?: SupplementPin | null;
  supplementFeed?: SupplementFeedOptions | null;
}

export interface BuildinfoEntry {
  feed: string;
  commit: string;
}

export function parseBuildinfoEntries(text: string): BuildinfoEntry[] {
  const entries = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = /^src-git\s+(\S+)\s+\S+\^([0-9a-f]{40})$/.exec(line);
      if (!match) throw new Error(`unexpected feeds.buildinfo line: ${line}`);
      return { feed: match[1], commit: match[2] };
    })
    .sort((a, b) => a.feed.localeCompare(b.feed));

  if (entries.length === 0) throw new Error("feeds.buildinfo is empty");
  return entries;
}

export function parseBuildinfo(text: string): string {
  const entries = parseBuildinfoEntries(text).map((entry) => `${entry.feed} ${entry.commit}`);
  return createHash("sha256").update(entries.join("\n")).digest("hex").slice(0, 16);
}

export function sharedSupplementSourceCommit(text: string): string | null {
  try {
    const json = JSON.parse(text) as { packages?: Array<{ sourceCommit?: unknown }> };
    const commits = new Set(
      (json.packages ?? [])
        .map((pkg) => pkg.sourceCommit)
        .filter((commit): commit is string => typeof commit === "string" && /^[0-9a-f]{40}$/.test(commit)),
    );
    return commits.size === 1 ? [...commits][0] : null;
  } catch {
    return null;
  }
}

export function composeFeedCommit(pins: SourcePins): string {
  const canonical = JSON.stringify({
    official: Object.fromEntries(Object.entries(pins.official).sort(([a], [b]) => a.localeCompare(b))),
    dllkids: pins.dllkids,
    supplement: pins.supplement,
  });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

function dumpAdb(apkBin: string, file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(apkBin, ["adbdump", file], { maxBuffer: 64 * 1024 * 1024, encoding: "utf8" }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

function verifyAdb(apkBin: string, keyDir: string, file: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(apkBin, ["verify", "--keys-dir", keyDir, file], { encoding: "utf8" }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function createImmortalWrtSource(options: ImmortalWrtSourceOptions): CatalogSource {
  const {
    baseVersion,
    apkBin = "apk",
    fetchImpl = fetch,
    dllkids = null,
    supplement = null,
    supplementFeed = null,
  } = options;
  const root = `${RELEASE_ROOT}/${baseVersion}`;
  let kernel: KernelPin | undefined;
  let pins: SourcePins | undefined;
  let dllkidsDump: string | undefined;
  let dllkidsUrl: string | undefined;
  let supplementDump: string | undefined;
  let supplementPin: SupplementPin | null = supplement;
  let supplementUrl: string | undefined;

  async function get(url: string): Promise<Response> {
    const response = await fetchImpl(url);
    if (!response.ok) throw new Error(`GET ${url} failed: ${response.status}`);
    return response;
  }

  async function loadDllkidsIndex(): Promise<string | undefined> {
    if (!dllkids) return undefined;
    const url = `${dllkids.baseUrl.replace(/\/$/, "")}/packages.adb`;
    dllkidsUrl = url;
    const response = await get(url);
    const buffer = Buffer.from(await response.arrayBuffer());
    const actual = sha256(buffer);
    if (actual !== dllkids.indexSha256) {
      throw new Error(
        `dllkids packages.adb sha256 mismatch: expected ${dllkids.indexSha256}, got ${actual} (${url})`,
      );
    }
    const dir = await mkdtemp(join(tmpdir(), "combinewrt-dllkids-"));
    try {
      const file = join(dir, "packages.adb");
      await writeFile(file, buffer);
      return await dumpAdb(apkBin, file);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  async function readSupplementCommit(baseUrl: string): Promise<string | null> {
    const url = new URL("../publish.json", `${baseUrl}/`).toString();
    try {
      const response = await fetchImpl(url);
      if (!response.ok) return null;
      return sharedSupplementSourceCommit(await response.text());
    } catch {
      return null;
    }
  }

  async function loadSupplementIndex(): Promise<string | undefined> {
    if (!supplementFeed) return undefined;
    const baseUrl = supplementFeed.baseUrl.replace(/\/$/, "");
    const indexUrl = `${baseUrl}/packages.adb`;
    supplementUrl = indexUrl;

    const [indexResponse, keyResponse] = await Promise.all([get(indexUrl), get(supplementFeed.keyUrl)]);
    const index = Buffer.from(await indexResponse.arrayBuffer());
    const key = Buffer.from(await keyResponse.arrayBuffer());
    const indexSha256 = sha256(index);
    const keySha256 = sha256(key);
    if (keySha256 !== supplementFeed.keyFingerprint) {
      throw new Error(
        `supplement feed key sha256 mismatch: expected ${supplementFeed.keyFingerprint}, got ${keySha256} (${supplementFeed.keyUrl})`,
      );
    }
    if (supplement?.fingerprint && supplement.fingerprint !== keySha256) {
      throw new Error(
        `supplement source pin key mismatch: expected ${supplement.fingerprint}, got ${keySha256} (${supplementFeed.keyUrl})`,
      );
    }

    const dir = await mkdtemp(join(tmpdir(), "combinewrt-supplement-"));
    try {
      const keyDir = join(dir, "keys");
      await mkdir(keyDir, { recursive: true });
      const keyFile = join(keyDir, "combinewrt-feed.pub.pem");
      const indexFile = join(dir, "packages.adb");
      await writeFile(keyFile, key);
      await writeFile(indexFile, index);
      await verifyAdb(apkBin, keyDir, indexFile);
      const sourceCommit = await readSupplementCommit(baseUrl);
      supplementPin = {
        commit: supplement?.commit ?? sourceCommit,
        fingerprint: keySha256,
        indexSha256,
      };
      return await dumpAdb(apkBin, indexFile);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  async function loadMeta() {
    const profilesUrl = `${root}/targets/x86/64/profiles.json`;
    const buildinfoUrl = `${root}/targets/x86/64/feeds.buildinfo`;

    const [profilesResponse, buildinfoResponse, dllkidsIndex, supplementIndex] = await Promise.all([
      get(profilesUrl),
      get(buildinfoUrl),
      loadDllkidsIndex(),
      loadSupplementIndex(),
    ]);

    const json = (await profilesResponse.json()) as {
      linux_kernel?: KernelPin;
    };
    kernel = json.linux_kernel;
    if (!kernel) throw new Error("profiles.json is missing linux_kernel");
    dllkidsDump = dllkidsIndex;
    supplementDump = supplementIndex;

    const buildinfoEntries = parseBuildinfoEntries(await buildinfoResponse.text());
    const official: Record<string, string> = Object.fromEntries(
      buildinfoEntries.map((entry) => [entry.feed, entry.commit]),
    );
    // base/target/kmods are part of the release rather than feeds.buildinfo;
    // pin them to the release version and the kernel ABI respectively.
    official.base = `release:${baseVersion}`;
    official.target = `release:${baseVersion}`;
    official.kmods = `kernel:${kernel.version}-${kernel.release}-${kernel.vermagic}`;

    pins = {
      official,
      dllkids: dllkids ? dllkids.indexSha256 : null,
      supplement: supplementPin,
      kernel,
    };

    const notes = [profilesUrl, buildinfoUrl];
    if (dllkidsUrl) notes.push(dllkidsUrl);
    if (supplementUrl) notes.push(supplementUrl);
    if (supplementPin?.commit) notes.push(`supplement commit ${supplementPin.commit}`);
    if (supplementPin?.fingerprint) notes.push(`supplement key ${supplementPin.fingerprint}`);
    if (supplementPin?.indexSha256) notes.push(`supplement index sha256 ${supplementPin.indexSha256}`);

    return {
      profilesJson: json,
      feedCommit: composeFeedCommit(pins),
      sourceNote: notes.join(" | "),
      sourcePins: pins,
    };
  }

  async function loadDumps() {
    if (!kernel || !pins) throw new Error("loadMeta must run before loadDumps");
    const officialRoot = `${root}/packages/x86_64`;
    const targetRoot = `${root}/targets/x86/64`;
    const kmodsRoot = `${targetRoot}/kmods/${kernel.version}-${kernel.release}-${kernel.vermagic}`;
    const feeds: Array<{ feed: string; url: string; downloadBase: string }> = [
      { feed: "base", url: `${officialRoot}/base/packages.adb`, downloadBase: `${officialRoot}/base` },
      { feed: "luci", url: `${officialRoot}/luci/packages.adb`, downloadBase: `${officialRoot}/luci` },
      { feed: "packages", url: `${officialRoot}/packages/packages.adb`, downloadBase: `${officialRoot}/packages` },
      { feed: "routing", url: `${officialRoot}/routing/packages.adb`, downloadBase: `${officialRoot}/routing` },
      { feed: "telephony", url: `${officialRoot}/telephony/packages.adb`, downloadBase: `${officialRoot}/telephony` },
      { feed: "target", url: `${targetRoot}/packages/packages.adb`, downloadBase: `${targetRoot}/packages` },
      { feed: "kmods", url: `${kmodsRoot}/packages.adb`, downloadBase: kmodsRoot },
    ];

    const dir = await mkdtemp(join(tmpdir(), "combinewrt-catalog-"));
    try {
      const dumps: Array<{
        feed: string;
        dump: string;
        source: "official" | "dllkids" | "supplement";
        sourcePin: string;
        downloadBase: string;
      }> = [];
      for (const { feed, url, downloadBase } of feeds) {
        const response = await get(url);
        const buffer = Buffer.from(await response.arrayBuffer());
        const file = join(dir, `${feed}.adb`);
        await writeFile(file, buffer);
        dumps.push({
          feed,
          dump: await dumpAdb(apkBin, file),
          source: "official",
          sourcePin: pins.official[feed] ?? "",
          downloadBase,
        });
      }
      if (dllkidsDump && dllkids) {
        dumps.push({
          feed: "dllkids",
          dump: dllkidsDump,
          source: "dllkids",
          sourcePin: dllkids.indexSha256,
          downloadBase: dllkids.baseUrl.replace(/\/$/, ""),
        });
      }
      if (supplementDump && supplementFeed && supplementPin) {
        dumps.push({
          feed: "supplement",
          dump: supplementDump,
          source: "supplement",
          // Package provenance follows the source revision (index checksum,
          // falling back to the published commit), not the signing key.
          sourcePin:
            supplementPin.indexSha256 ?? supplementPin.commit ?? supplementPin.fingerprint ?? supplementFeed.keyFingerprint,
          downloadBase: supplementFeed.baseUrl.replace(/\/$/, ""),
        });
      }
      return dumps;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(
          `apk-tools 3 not found (${apkBin}). Set APK_BIN to the ImageBuilder apk binary, e.g. staging_dir/host/bin/apk.`,
        );
      }
      throw error;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  return { baseVersion, loadMeta, loadDumps };
}
