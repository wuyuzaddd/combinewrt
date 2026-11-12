import type { ReleaseCandidate, ReleaseInfo } from "./types";

export const RELEASES_ROOT = "https://downloads.immortalwrt.org/releases";

const STABLE_VERSION = /^\d+\.\d+\.\d+$/;
const RELEASE_ROW = /<a href="([^"]+)\/">[^<]*<\/a>\/<\/td><td class="s">[^<]*<\/td><td class="d">([^<]+)<\/td>/g;
const IMAGEBUILDER_SUM = /\b([0-9a-f]{64})\s+\*?immortalwrt-imagebuilder-([0-9.]+)-x86-64\.Linux-x86_64\.tar\.zst\b/;

export function imageBuilderUrl(version: string): string {
  return `${RELEASES_ROOT}/${version}/targets/x86/64/immortalwrt-imagebuilder-${version}-x86-64.Linux-x86_64.tar.zst`;
}

export function checksumUrl(version: string): string {
  return `${RELEASES_ROOT}/${version}/targets/x86/64/sha256sums`;
}

function toIsoDate(value: string): string | null {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

export function parseReleaseIndex(html: string): ReleaseInfo[] {
  const releases: ReleaseInfo[] = [];
  for (const match of html.matchAll(RELEASE_ROW)) {
    const version = match[1].replace(/\/$/, "");
    if (!STABLE_VERSION.test(version)) continue;
    releases.push({ version, releaseDate: toIsoDate(match[2].trim()) });
  }
  return releases;
}

export function compareVersions(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function latestRelease(releases: ReleaseInfo[]): ReleaseInfo | null {
  return releases.reduce<ReleaseInfo | null>(
    (latest, release) =>
      !latest || compareVersions(release.version, latest.version) > 0 ? release : latest,
    null,
  );
}

export function parseImageBuilderSha256(text: string, version: string): string | null {
  for (const match of text.matchAll(new RegExp(IMAGEBUILDER_SUM.source, "g"))) {
    if (match[2] === version) return match[1];
  }
  return null;
}

export async function fetchReleaseCandidate(
  version: string,
  releaseDate: string | null,
  fetchImpl: typeof fetch,
): Promise<ReleaseCandidate> {
  const response = await fetchImpl(checksumUrl(version));
  if (!response.ok) {
    throw new Error(`failed to fetch checksums for ImmortalWrt ${version}: HTTP ${response.status}`);
  }
  const checksum = parseImageBuilderSha256(await response.text(), version);
  if (!checksum) {
    throw new Error(`ImageBuilder checksum for ImmortalWrt ${version} was not found in sha256sums`);
  }
  return { version, releaseDate, imageBuilderUrl: imageBuilderUrl(version), imageBuilderSha256: checksum };
}
