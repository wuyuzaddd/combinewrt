import type { AppConfig } from "../config";
import type { ImmortalWrtSourceOptions } from "./source";

/**
 * Builds the source options shared by manual catalog refresh and base-version
 * bump. Keeping the config mapping here stops the supplement pin and feed
 * options from drifting between call sites.
 */
export function createConfiguredImmortalWrtSource(
  config: Pick<
    AppConfig,
    | "apkBin"
    | "dllkidsFeedUrl"
    | "dllkidsIndexSha256"
    | "supplementFeedCommit"
    | "supplementKeyFingerprint"
    | "supplementFeedUrl"
    | "supplementKeyUrl"
  >,
  baseVersion: string,
): ImmortalWrtSourceOptions {
  return {
    baseVersion,
    apkBin: config.apkBin,
    dllkids: { baseUrl: config.dllkidsFeedUrl, indexSha256: config.dllkidsIndexSha256 },
    supplement:
      config.supplementFeedCommit || config.supplementKeyFingerprint
        ? {
            commit: config.supplementFeedCommit,
            fingerprint: config.supplementKeyFingerprint,
          }
        : null,
    supplementFeed: config.supplementFeedUrl
      ? {
          baseUrl: config.supplementFeedUrl,
          keyUrl: config.supplementKeyUrl,
          keyFingerprint: config.supplementKeyFingerprint,
        }
      : null,
  };
}
