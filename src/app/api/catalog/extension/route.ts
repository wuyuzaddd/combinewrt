import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current-session";
import { createExtensionCatalog } from "@/lib/extension/catalog";
import { loadExtensionBundles } from "@/lib/extension/bundles";
import { loadExtensionThemes } from "@/lib/extension/themes";
import { loadSourceRegistry } from "@/lib/sources/registry";

/**
 * Read-only extension catalog (ticket 12): search extension packages, bundles
 * and theme metadata. Requires a session like the package catalog API.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";

  try {
    const registry = loadSourceRegistry();
    const catalog = createExtensionCatalog({
      registry,
      themes: loadExtensionThemes({ registry }),
      bundles: loadExtensionBundles({ registry }),
      query,
    });
    return NextResponse.json({ ok: true, ...catalog });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
