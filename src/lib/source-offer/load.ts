import { createBaseVersionStore } from "../base/store";
import { getDatabase } from "../db";
import type { BuildRecord } from "../builds/types";
import { createSourceOffer, type SourceOfferManifest } from "./manifest";

/**
 * Server-side entry point for the source offer. Keeps page and JSON route on
 * the same image-builder metadata and plan fallbacks.
 */
export function loadSourceOffer(build: BuildRecord): SourceOfferManifest {
  const base = createBaseVersionStore(getDatabase()).get(build.plan.baseVersion);
  return createSourceOffer(build, { imageBuilder: base });
}
