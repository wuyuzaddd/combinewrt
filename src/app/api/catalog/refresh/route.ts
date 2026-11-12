import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current-session";
import { getConfig } from "@/lib/config";
import { getDatabase } from "@/lib/db";
import { createBaseVersionStore } from "@/lib/base/store";
import { refreshCatalog } from "@/lib/catalog/service";
import { createCatalogStore } from "@/lib/catalog/store";
import { createImmortalWrtSource } from "@/lib/catalog/source";

export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const config = getConfig();
    const db = getDatabase();
    const baseVersion = createBaseVersionStore(db).active()?.version ?? config.baseVersion;
    const result = await refreshCatalog({
      source: createImmortalWrtSource({
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
      }),
      db,
    });
    createCatalogStore(db).activateSnapshot(result.snapshot.id);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("catalog refresh failed", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "catalog refresh failed" },
      { status: 502 },
    );
  }
}
