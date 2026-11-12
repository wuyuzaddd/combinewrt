import type { CatalogPackage } from "../catalog/types";
import type { PackageLookupEntry } from "./types";

export function toLookupEntry(pkg: CatalogPackage): PackageLookupEntry {
  return {
    version: pkg.version,
    depends: pkg.depends,
    source: pkg.source,
    sourcePin: pkg.sourcePin,
    sha256: pkg.sha256,
    filename: pkg.filename,
    downloadUrl: pkg.downloadUrl,
    feed: pkg.feed,
  };
}
