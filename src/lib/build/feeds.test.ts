import { describe, expect, it } from "vitest";
import type { Target } from "../domain/types";
import type { ResolvedEntry } from "./types";
import {
  DEFAULT_IMAGE_FEED_OPTIONS,
  DLLKIDS_WRAPPER_PATH,
  IMAGE_FEED_KEY_PATH,
  IMAGE_FEED_LIST_PATH,
  OFFICIAL_FEED_BASE,
  buildImageFeedSet,
  createImagePreflight,
  type ImageFeedPlanInput,
} from "./feeds";

const target: Target = { id: "x86/64", architecture: "x86_64", subtarget: "64", title: "x86/64" };
const kernel = { version: "6.12.103", release: "1", vermagic: "abc123" };

function input(overrides: Partial<ImageFeedPlanInput> = {}): ImageFeedPlanInput {
  return {
    baseVersion: "25.12.2",
    target,
    kernel,
    visibility: "public",
    ...overrides,
  };
}

function packageEntry(source: string): Pick<ResolvedEntry, "packageSource"> {
  return { packageSource: source as ResolvedEntry["packageSource"] };
}

const SUPPLEMENT_URL =
  "https://wuyuzaddd.github.io/combinewrt-packages/supplement/25.12.2/x86_64/packages.adb";
const EXTENSION_URL =
  "https://wuyuzaddd.github.io/combinewrt-packages/extension/25.12.2/x86_64/packages.adb";
const DLLKIDS_URL = "https://down.dllkids.xyz/openwrt-feed/25.12/x86_64/packages.adb";

describe("buildImageFeedSet", () => {
  it("keeps distfeeds.list and writes a version-frozen project feed list", () => {
    const feedSet = buildImageFeedSet(input());

    expect(feedSet.files.map((file) => file.path)).toEqual([IMAGE_FEED_LIST_PATH]);
    const list = feedSet.files[0]!;
    expect(list.mode).toBe(0o644);
    expect(list.content).toContain("distfeeds.list");
    expect(list.content).toContain(SUPPLEMENT_URL);
    expect(list.content).not.toContain("latest");
    // The official feeds already come from the preserved distfeeds.list.
    expect(list.content).not.toContain("downloads.immortalwrt.org");
    expect(list.content).not.toContain(DLLKIDS_URL);
  });

  it("installs the project public key and records the fingerprint", () => {
    const feedSet = buildImageFeedSet(input());

    expect(feedSet.key).toEqual({
      path: IMAGE_FEED_KEY_PATH,
      url: DEFAULT_IMAGE_FEED_OPTIONS.keyUrl,
      fingerprint: DEFAULT_IMAGE_FEED_OPTIONS.keyFingerprint,
    });
    expect(feedSet.repositories.find((repo) => repo.id === "supplement")).toMatchObject({
      signed: true,
      keyFingerprint: DEFAULT_IMAGE_FEED_OPTIONS.keyFingerprint,
      inDefaultRepositoryList: true,
    });
  });

  it("gives public and private plans different feed sets", () => {
    const publicSet = buildImageFeedSet(input({ visibility: "public" }));
    const privateSet = buildImageFeedSet(input({ visibility: "private" }));

    expect(publicSet.repositories.map((repo) => repo.id)).toEqual(["official", "supplement"]);
    expect(privateSet.repositories.map((repo) => repo.id)).toEqual([
      "official",
      "supplement",
      "dllkids",
    ]);

    const dllkids = privateSet.repositories.find((repo) => repo.id === "dllkids")!;
    expect(dllkids).toMatchObject({
      signed: false,
      inDefaultRepositoryList: false,
      keyFingerprint: null,
      indexSha256: DEFAULT_IMAGE_FEED_OPTIONS.dllkidsIndexSha256,
      url: DLLKIDS_URL,
    });
    expect(privateSet.files.map((file) => file.path)).toEqual([
      IMAGE_FEED_LIST_PATH,
      DLLKIDS_WRAPPER_PATH,
    ]);
    // The public image never carries the unsigned feed or the wrapper.
    expect(publicSet.files.map((file) => file.path)).not.toContain(DLLKIDS_WRAPPER_PATH);
    expect(JSON.stringify(publicSet)).not.toContain("dllkids.xyz");
  });

  it("only lets the explicit wrapper use --allow-untrusted", () => {
    const feedSet = buildImageFeedSet(input({ visibility: "private" }));
    const wrapper = feedSet.files.find((file) => file.path === DLLKIDS_WRAPPER_PATH)!;

    expect(wrapper.mode).toBe(0o755);
    expect(wrapper.content).toContain("exec apk --allow-untrusted --repository");
    expect(wrapper.content).toContain(DLLKIDS_URL);
    expect(wrapper.content).toContain("default `apk` command keeps signature verification");
    // The wrapper is not a repository line, so a plain `apk add` cannot reach it.
    const list = feedSet.files.find((file) => file.path === IMAGE_FEED_LIST_PATH)!;
    expect(list.content).not.toContain("dllkids");
  });

  it("adds the signed extension feed only when extension packages are selected", () => {
    const without = buildImageFeedSet(input({ resolved: [packageEntry("official")] }));
    expect(without.repositories.map((repo) => repo.id)).not.toContain("extension");
    expect(without.files[0]!.content).not.toContain(EXTENSION_URL);

    const withExtension = buildImageFeedSet(
      input({ resolved: [packageEntry("official"), packageEntry("extension")] }),
    );
    const extension = withExtension.repositories.find((repo) => repo.id === "extension")!;
    expect(extension).toMatchObject({
      url: EXTENSION_URL,
      signed: true,
      inDefaultRepositoryList: true,
      keyFingerprint: DEFAULT_IMAGE_FEED_OPTIONS.keyFingerprint,
    });
    expect(withExtension.files[0]!.content).toContain(EXTENSION_URL);
  });

  it("accepts an explicit extension selection for callers before PackageSource grows extension", () => {
    const feedSet = buildImageFeedSet(
      input({ extensionSelected: true, resolved: [packageEntry("official")] }),
    );
    expect(feedSet.repositories.map((repo) => repo.id)).toContain("extension");
  });

  it("records the actually used official base and honours IMMORTALWRT_MIRROR", () => {
    const mirror = "https://mirror.example.test/immortalwrt";
    const feedSet = buildImageFeedSet(
      input(),
      { officialBaseUrl: mirror, officialMirror: mirror },
    );

    expect(feedSet.officialBaseUrl).toBe(mirror);
    expect(feedSet.officialMirror).toBe(mirror);
    expect(feedSet.officialRepositories).toContain(
      "https://mirror.example.test/immortalwrt/releases/25.12.2/targets/x86/64/packages/packages.adb",
    );
    // A mirror needs a repository line; the canonical setup relies on distfeeds.list.
    const list = feedSet.files.find((file) => file.path === IMAGE_FEED_LIST_PATH)!;
    expect(list.content).toContain(
      "https://mirror.example.test/immortalwrt/releases/25.12.2/targets/x86/64/packages/packages.adb",
    );
  });

  it("keeps the URL version-frozen when the base version changes", () => {
    const older = buildImageFeedSet(input({ baseVersion: "25.9.0" }));
    expect(older.repositories.find((repo) => repo.id === "supplement")!.url).toBe(
      "https://wuyuzaddd.github.io/combinewrt-packages/supplement/25.9.0/x86_64/packages.adb",
    );
    expect(older.repositories.find((repo) => repo.id === "supplement")!.url).not.toContain("latest");
  });

  it("records the supplement index pin separately from the extension pin", () => {
    const feedSet = buildImageFeedSet(
      input({ resolved: [packageEntry("extension")] }),
      { supplementIndexSha256: "a".repeat(64), extensionIndexSha256: "b".repeat(64) },
    );
    expect(feedSet.repositories.find((repo) => repo.id === "supplement")!.indexSha256).toBe(
      "a".repeat(64),
    );
    expect(feedSet.repositories.find((repo) => repo.id === "extension")!.indexSha256).toBe(
      "b".repeat(64),
    );
  });
});

describe("createImagePreflight", () => {
  it("lists the exact final package set and repository set without weakening verification", () => {
    const feedSet = buildImageFeedSet(input({ visibility: "private" }));
    const preflight = createImagePreflight(feedSet, ["luci", "lucky", "luci-app-demo"]);

    expect(preflight.packages).toEqual(["luci", "lucky", "luci-app-demo"]);
    expect(preflight.allowUntrusted).toBe(false);
    expect(preflight.localRepository).toBe("packages");
    expect(preflight.repositories).toEqual([
      ...feedSet.officialRepositories,
      SUPPLEMENT_URL,
    ]);
    expect(preflight.repositories.join("\n")).not.toContain(DLLKIDS_URL);
  });

  it("adds the extension repository when the plan selected extension packages", () => {
    const feedSet = buildImageFeedSet(
      input({ resolved: [packageEntry("extension")], extensionSelected: true }),
    );
    const preflight = createImagePreflight(feedSet, ["luci"]);
    expect(preflight.repositories).toContain(EXTENSION_URL);
  });

  it("is fully described by plain URLs, so the workflow can preflight before make image", () => {
    const preflight = createImagePreflight(buildImageFeedSet(input()), ["luci"]);
    for (const url of preflight.repositories) {
      expect(url).toMatch(/^https?:\/\//);
      expect(url).not.toContain("latest");
    }
    expect(preflight.repositories).toContain(OFFICIAL_FEED_BASE + "/releases/25.12.2/packages/x86_64/packages/packages.adb");
  });
});
