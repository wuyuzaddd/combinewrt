import type { PackageLookupEntry } from "../build/types";
import type { SourceRegistryEntry } from "../sources/types";

/**
 * Turn an extension registry entry into the lookup shape the V1 planner uses.
 *
 * Extension packages are not downloaded: the extension feed `packages.adb`
 * provides them at build time, so `sha256`/`filename`/`downloadUrl` stay null
 * and the download manifest skips them. The pinned ref is the verifiable
 * identity, which is what `sourcePin` carries.
 */
export function extensionLookupEntry(entry: SourceRegistryEntry): PackageLookupEntry | null {
  if (entry.source !== "extension") return null;
  const ref = entry.ref ?? entry.pin ?? "";
  return {
    version: ref.slice(0, 12) || "0",
    depends: [],
    source: "extension",
    sourcePin: entry.pin ?? ref,
    sha256: null,
    filename: null,
    downloadUrl: null,
    feed: "extension",
    license: entry.license ?? null,
    proprietary: false,
  };
}
