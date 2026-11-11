import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CatalogSource } from "./service";

const RELEASE_ROOT = "https://downloads.immortalwrt.org/releases";

interface KernelInfo {
  version: string;
  release: string;
  vermagic: string;
}

export interface ImmortalWrtSourceOptions {
  baseVersion: string;
  apkBin?: string;
  fetchImpl?: typeof fetch;
}

function dumpAdb(apkBin: string, file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(apkBin, ["adbdump", file], { maxBuffer: 64 * 1024 * 1024, encoding: "utf8" }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

export function parseBuildinfo(text: string): string {
  const entries = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = /^src-git\s+(\S+)\s+\S+\^([0-9a-f]{40})$/.exec(line);
      if (!match) throw new Error(`unexpected feeds.buildinfo line: ${line}`);
      return `${match[1]} ${match[2]}`;
    })
    .sort();

  if (entries.length === 0) throw new Error("feeds.buildinfo is empty");
  return createHash("sha256").update(entries.join("\n")).digest("hex").slice(0, 16);
}

export function createImmortalWrtSource(options: ImmortalWrtSourceOptions): CatalogSource {
  const { baseVersion, apkBin = "apk", fetchImpl = fetch } = options;
  const root = `${RELEASE_ROOT}/${baseVersion}`;
  let kernel: KernelInfo | undefined;

  async function get(url: string): Promise<Response> {
    const response = await fetchImpl(url);
    if (!response.ok) throw new Error(`GET ${url} failed: ${response.status}`);
    return response;
  }

  async function loadMeta() {
    const profilesUrl = `${root}/targets/x86/64/profiles.json`;
    const buildinfoUrl = `${root}/targets/x86/64/feeds.buildinfo`;

    const json = (await (await get(profilesUrl)).json()) as {
      linux_kernel?: KernelInfo;
    };
    kernel = json.linux_kernel;
    if (!kernel) throw new Error("profiles.json is missing linux_kernel");

    const buildinfo = await (await get(buildinfoUrl)).text();
    return {
      profilesJson: json,
      feedCommit: parseBuildinfo(buildinfo),
      sourceNote: `${profilesUrl} | ${buildinfoUrl}`,
    };
  }

  async function loadDumps() {
    if (!kernel) throw new Error("loadMeta must run before loadDumps");
    const feeds = [
      { feed: "base", url: `${root}/packages/x86_64/base/packages.adb` },
      { feed: "luci", url: `${root}/packages/x86_64/luci/packages.adb` },
      { feed: "packages", url: `${root}/packages/x86_64/packages/packages.adb` },
      { feed: "routing", url: `${root}/packages/x86_64/routing/packages.adb` },
      { feed: "telephony", url: `${root}/packages/x86_64/telephony/packages.adb` },
      { feed: "target", url: `${root}/targets/x86/64/packages/packages.adb` },
      {
        feed: "kmods",
        url: `${root}/targets/x86/64/kmods/${kernel.version}-${kernel.release}-${kernel.vermagic}/packages.adb`,
      },
    ];

    const dir = await mkdtemp(join(tmpdir(), "combinewrt-catalog-"));
    try {
      const dumps: Array<{ feed: string; dump: string }> = [];
      for (const { feed, url } of feeds) {
        const response = await get(url);
        const buffer = Buffer.from(await response.arrayBuffer());
        const file = join(dir, `${feed}.adb`);
        await writeFile(file, buffer);
        dumps.push({ feed, dump: await dumpAdb(apkBin, file) });
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
