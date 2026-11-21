import type { PackageSource, SourcePins } from "../catalog/types";
import type { Target } from "../domain/types";
import type { BuildVisibility, GeneratedFile } from "./types";

/**
 * The image feed set is the set of apk repositories the installed system uses
 * for later package installation. It deliberately does not change build-time
 * package resolution: the workflow keeps downloading pinned packages and
 * signing one local index (ADR 0007).
 */

/** The ImageBuilder-generated file is kept, never rewritten. */
export const DISTFEEDS_PATH = "/etc/apk/repositories.d/distfeeds.list";
export const IMAGE_FEED_LIST_PATH = "/etc/apk/repositories.d/90-combinewrt.list";
export const IMAGE_FEED_KEY_PATH = "/etc/apk/keys/combinewrt-feed.pub.pem";
export const DLLKIDS_WRAPPER_PATH = "/usr/sbin/apk-dllkids";
export const OFFICIAL_FEED_BASE = "https://downloads.immortalwrt.org";
export const DEFAULT_FEED_BASE_URL = "https://wuyuzaddd.github.io/combinewrt-packages";
export const DEFAULT_FEED_KEY_URL = `${DEFAULT_FEED_BASE_URL}/keys/combinewrt-feed.pub.pem`;
export const DEFAULT_FEED_KEY_FINGERPRINT =
  "f71286670f3cc138ec4f55e650c6aa4ed2bd7fff7d29851aef2ac53bae72d083";
export const DEFAULT_DLLKIDS_FEED_URL = "https://down.dllkids.xyz/openwrt-feed/25.12/x86_64";
/**
 * Last-resort seed for a fresh installation that has no adopted database pin.
 *
 * ADR 0009 ruling 1: the `source_pins` row is authoritative. This constant
 * (and the `DLLKIDS_INDEX_SHA256_SEED` / legacy `DLLKIDS_INDEX_SHA256` env
 * override) only seeds the first pin; a plan may use it only when the database
 * has nothing, and must then mark it as a seed (`indexSha256Source` on the feed
 * repository). Keeping "env" out of the name is deliberate: environment
 * configuration is not a live authority.
 */
export const DEFAULT_DLLKIDS_INDEX_SHA256_SEED =
  "04a549ed7028b126218002b126cbc60eb3a4bdc3463f15425bce3ba6b91a04ba";

/**
 * @deprecated Prefer {@link DEFAULT_DLLKIDS_INDEX_SHA256_SEED}. The old name is
 * kept so downstream imports keep compiling; it has the same seed semantics.
 */
export const DEFAULT_DLLKIDS_INDEX_SHA256 = DEFAULT_DLLKIDS_INDEX_SHA256_SEED;

/** Where a feed's `indexSha256` came from. */
export type IndexSha256Source = "snapshot" | "database" | "config-seed";

/**
 * GeneratedFile paths are relative to the ImageBuilder tree (the workflow runs
 * from `ib/` and hands `FILES=files` to make), so image paths get a `files/`
 * prefix here.
 */
export function feedPlanPath(imagePath: string): string {
  return `files${imagePath}`;
}

export type ImageFeedId = "official" | "supplement" | "extension" | "dllkids";

export interface ImageFeedRepository {
  id: ImageFeedId;
  /** Version-frozen URL (never a rolling channel or `latest`). */
  url: string;
  signed: boolean;
  /**
   * True when the workflow writes this URL to 90-combinewrt.list. The official
   * canonical feeds are already listed by distfeeds.list, so they are only
   * written when an IMMORTALWRT_MIRROR override has to replace the base.
   */
  inDefaultRepositoryList: boolean;
  /** Why this repository is (or is not) part of the image, for the source offer. */
  condition: string;
  /** sha256 of the signed packages.adb where the project publishes a pin. */
  indexSha256: string | null;
  /**
   * Authority of `indexSha256` where it is a dllkids pin. `snapshot` is the
   * pin recorded by the catalog snapshot the plan resolved (the normal case);
   * `database` is the live DB pin and `config-seed` the last-resort seed used
   * for a snapshot with no pin (ADR 0009 ruling 1). Absent on other feeds.
   */
  indexSha256Source?: IndexSha256Source;
  /** sha256 fingerprint of the project key; null for unsigned feeds. */
  keyFingerprint: string | null;
}

export interface ImageFeedKey {
  path: string;
  url: string;
  fingerprint: string;
}

export interface ImageFeedSet {
  visibility: BuildVisibility;
  baseVersion: string;
  /** OpenWrt target id, e.g. x86/64. */
  targetId: string;
  /** Published feed directory name, e.g. x86_64. */
  feedTarget: string;
  /** The official ImmortalWrt base actually used (canonical or mirror). */
  officialBaseUrl: string;
  /** The raw IMMORTALWRT_MIRROR override, null when the canonical base is used. */
  officialMirror: string | null;
  /** Exact official feed URLs for the build-time preflight. */
  officialRepositories: string[];
  key: ImageFeedKey;
  repositories: ImageFeedRepository[];
  /** Generated files that belong in `plan.files`. */
  files: GeneratedFile[];
}

export interface ImagePreflight {
  /** Exact package list passed to make image; the preflight resolves it against the feeds. */
  packages: string[];
  /** Remote repository URLs, in load order. */
  repositories: string[];
  /** Signed local index built by the workflow from the pinned downloads. */
  localRepository: string;
  /** The default image feeds never weaken signature verification. */
  allowUntrusted: false;
}

export interface ResolvedImageFeedOptions {
  officialBaseUrl: string;
  officialMirror: string | null;
  feedBaseUrl: string;
  keyUrl: string;
  keyFingerprint: string;
  supplementIndexSha256: string | null;
  extensionIndexSha256: string | null;
  dllkidsFeedUrl: string;
  dllkidsIndexSha256: string;
}

export const DEFAULT_IMAGE_FEED_OPTIONS: ResolvedImageFeedOptions = {
  officialBaseUrl: OFFICIAL_FEED_BASE,
  officialMirror: null,
  feedBaseUrl: DEFAULT_FEED_BASE_URL,
  keyUrl: DEFAULT_FEED_KEY_URL,
  keyFingerprint: DEFAULT_FEED_KEY_FINGERPRINT,
  supplementIndexSha256: null,
  extensionIndexSha256: null,
  dllkidsFeedUrl: DEFAULT_DLLKIDS_FEED_URL,
  dllkidsIndexSha256: DEFAULT_DLLKIDS_INDEX_SHA256_SEED,
};

export interface ImageFeedPlanInput {
  baseVersion: string;
  target: Target;
  /** Kernel pin from the catalog; the official kmods feed needs it. */
  kernel?: SourcePins["kernel"];
  visibility: BuildVisibility;
  /** Resolved plan entries; used to detect selected extension packages. */
  resolved?: readonly { packageSource: PackageSource | null }[];
  /** Download entries; the same detection for old plans without `resolved`. */
  downloads?: readonly { source: string }[];
  /** Explicit override when a caller already knows the extension feed is wanted. */
  extensionSelected?: boolean;
  /**
   * Authority of the dllkids index pin. The caller (the V2 planner) derives it
   * from `plan.sourcePins`; it defaults to `database` for direct callers.
   */
  dllkidsIndexSha256Source?: IndexSha256Source;
}

function trimBase(url: string): string {
  return url.replace(/\/+$/, "");
}

function officialFeedUrls(
  baseUrl: string,
  baseVersion: string,
  target: Target,
  kernel: SourcePins["kernel"],
): string[] {
  const root = `${trimBase(baseUrl)}/releases/${baseVersion}`;
  const archRoot = `${root}/packages/${target.architecture}`;
  const targetRoot = `${root}/targets/${target.id}`;
  const urls = [
    `${archRoot}/base/packages.adb`,
    `${archRoot}/luci/packages.adb`,
    `${archRoot}/packages/packages.adb`,
    `${archRoot}/routing/packages.adb`,
    `${archRoot}/telephony/packages.adb`,
    `${targetRoot}/packages/packages.adb`,
  ];
  if (kernel) {
    urls.push(`${targetRoot}/kmods/${kernel.version}-${kernel.release}-${kernel.vermagic}/packages.adb`);
  }
  return urls;
}

function projectFeedUrl(
  feedBaseUrl: string,
  kind: "supplement" | "extension",
  baseVersion: string,
  feedTarget: string,
): string {
  return `${trimBase(feedBaseUrl)}/${kind}/${baseVersion}/${feedTarget}/packages.adb`;
}

function selectsExtension(input: ImageFeedPlanInput): boolean {
  if (input.extensionSelected !== undefined) return input.extensionSelected;
  const fromResolved = (input.resolved ?? []).some((entry) => entry.packageSource === "extension");
  const fromDownloads = (input.downloads ?? []).some((entry) => entry.source === "extension");
  return fromResolved || fromDownloads;
}

/** POSIX single-quote a value for a shell script. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function repositoriesHeader(): string[] {
  return [
    "# combinewrt image feed set (V2)",
    "# distfeeds.list is generated by ImageBuilder and is preserved unchanged.",
    "# Project feeds are version-frozen: changing the base version changes these URLs.",
  ];
}

/**
 * Build the image feed set for a plan.
 *
 * Public: official + signed supplement (+ signed extension when selected).
 * Private: the same, plus an explicit `apk-dllkids` wrapper. The wrapper is the
 * only place that passes `--allow-untrusted`; it is never a repository line, so
 * the default `apk` command keeps official/supplement verification on.
 */
export function buildImageFeedSet(
  input: ImageFeedPlanInput,
  options: Partial<ResolvedImageFeedOptions> = {},
): ImageFeedSet {
  const resolvedOptions: ResolvedImageFeedOptions = { ...DEFAULT_IMAGE_FEED_OPTIONS, ...options };
  const officialBaseUrl = trimBase(
    resolvedOptions.officialBaseUrl || OFFICIAL_FEED_BASE,
  );
  const officialMirror = resolvedOptions.officialMirror
    ? trimBase(resolvedOptions.officialMirror)
    : null;
  const feedTarget = input.target.architecture;
  const officialRepositories = officialFeedUrls(
    officialBaseUrl,
    input.baseVersion,
    input.target,
    input.kernel ?? null,
  );

  const repositories: ImageFeedRepository[] = [
    {
      id: "official",
      url: `${officialBaseUrl}/releases/${input.baseVersion}`,
      signed: true,
      inDefaultRepositoryList: officialMirror !== null,
      condition: officialMirror
        ? "official ImmortalWrt feeds through the IMMORTALWRT_MIRROR override"
        : "official ImmortalWrt feeds; distfeeds.list is preserved unchanged",
      indexSha256: null,
      keyFingerprint: null,
    },
    {
      id: "supplement",
      url: projectFeedUrl(resolvedOptions.feedBaseUrl, "supplement", input.baseVersion, feedTarget),
      signed: true,
      inDefaultRepositoryList: true,
      condition: "signed supplement feed (always enabled)",
      indexSha256: resolvedOptions.supplementIndexSha256,
      keyFingerprint: resolvedOptions.keyFingerprint,
    },
  ];

  if (selectsExtension(input)) {
    repositories.push({
      id: "extension",
      url: projectFeedUrl(resolvedOptions.feedBaseUrl, "extension", input.baseVersion, feedTarget),
      signed: true,
      inDefaultRepositoryList: true,
      condition: "extension packages selected by the plan",
      indexSha256: resolvedOptions.extensionIndexSha256,
      keyFingerprint: resolvedOptions.keyFingerprint,
    });
  }

  const isPrivate = input.visibility === "private";
  if (isPrivate && resolvedOptions.dllkidsFeedUrl) {
    const dllkidsIndexSha256Source = input.dllkidsIndexSha256Source ?? "database";
    repositories.push({
      id: "dllkids",
      url: `${trimBase(resolvedOptions.dllkidsFeedUrl)}/packages.adb`,
      signed: false,
      inDefaultRepositoryList: false,
      condition:
        dllkidsIndexSha256Source === "config-seed"
          ? "private image only: explicit apk-dllkids wrapper, never in the default repository list; index sha256 is the configured seed because neither the snapshot nor the database has a pin"
          : dllkidsIndexSha256Source === "snapshot"
            ? "private image only: explicit apk-dllkids wrapper, never in the default repository list; index sha256 is the catalog snapshot's dllkids pin"
            : "private image only: explicit apk-dllkids wrapper, never in the default repository list; index sha256 is the database-adopted source pin",
      indexSha256: resolvedOptions.dllkidsIndexSha256,
      indexSha256Source: dllkidsIndexSha256Source,
      keyFingerprint: null,
    });
  }

  const listLines = repositoriesHeader();
  if (officialMirror) {
    listLines.push(
      "# Official feeds through IMMORTALWRT_MIRROR; distfeeds.list still names the canonical base.",
      ...officialRepositories,
    );
  }
  for (const repository of repositories) {
    if (!repository.inDefaultRepositoryList) continue;
    if (repository.id === "official") continue;
    listLines.push(repository.url);
  }

  const files: GeneratedFile[] = [
    {
      path: feedPlanPath(IMAGE_FEED_LIST_PATH),
      content: `${listLines.join("\n")}\n`,
      mode: 0o644,
    },
  ];

  if (isPrivate && resolvedOptions.dllkidsFeedUrl) {
    // Decision (2026-11-21): for a package that exists in both dllkids and our
    // signed feeds, the dllkids build is the authority in a private image. The
    // wrapper adds the dllkids index explicitly, and its date-derived versions
    // sort above ours, so apk resolves to the dllkids build. Nothing here tries
    // to outrank it: the public feeds never contain dllkids, and a private image
    // that wants our build simply does not call the wrapper.
    const dllkidsUrl = `${trimBase(resolvedOptions.dllkidsFeedUrl)}/packages.adb`;
    files.push({
      path: feedPlanPath(DLLKIDS_WRAPPER_PATH),
      content: [
        "#!/bin/sh",
        "# combinewrt private-image helper: install from the unsigned dllkids feed",
        "# on purpose. The default `apk` command keeps signature verification on;",
        "# only this wrapper passes --allow-untrusted.",
        `exec apk --allow-untrusted --repository ${shellQuote(dllkidsUrl)} "$@"`,
        "",
      ].join("\n"),
      mode: 0o755,
    });
  }

  return {
    visibility: input.visibility,
    baseVersion: input.baseVersion,
    targetId: input.target.id,
    feedTarget,
    officialBaseUrl,
    officialMirror,
    officialRepositories,
    key: {
      path: IMAGE_FEED_KEY_PATH,
      url: resolvedOptions.keyUrl,
      fingerprint: resolvedOptions.keyFingerprint,
    },
    repositories,
    files,
  };
}

/**
 * Describe the installability preflight the workflow runs before `make image`:
 * the exact package list against the final repository set.
 */
export function createImagePreflight(
  feedSet: ImageFeedSet,
  packages: readonly string[],
): ImagePreflight {
  const projectRepositories = feedSet.repositories
    .filter((repository) => repository.inDefaultRepositoryList && repository.id !== "official")
    .map((repository) => repository.url);
  return {
    packages: [...packages],
    repositories: [...feedSet.officialRepositories, ...projectRepositories],
    localRepository: "packages",
    allowUntrusted: false,
  };
}
