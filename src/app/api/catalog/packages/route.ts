import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current-session";
import { getDatabase } from "@/lib/db";
import { createCatalogStore } from "@/lib/catalog/store";
import { packageApplicability } from "@/lib/build/ui-options";
import { loadCommonPreset } from "@/lib/presets/common";
import { loadSourceRegistry } from "@/lib/sources/registry";
import { loadBlockedPackages } from "@/lib/catalog/blocked";
import type { I18nStatus } from "@/lib/sources/types";

interface SearchItem {
  name: string;
  description: string;
  source: string;
  license: string | null;
  i18nStatus: I18nStatus | null;
  applies: boolean;
  reason: string | null;
}

function statusOf(source: { i18n?: { status?: I18nStatus }; i18nStatus?: I18nStatus } | null): I18nStatus | null {
  return source?.i18n?.status ?? source?.i18nStatus ?? null;
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get("limit") || "20", 10) || 20, 1), 50);
  // The V2 form scopes search to the selected target/kernel line and asks for
  // extension packages too; V1 callers send neither and keep the old results.
  const targetId = url.searchParams.get("target") ?? undefined;
  const kernelLine = url.searchParams.get("kernelLine") ?? undefined;
  const includeExtension = url.searchParams.get("includeExtension") === "1";

  const store = createCatalogStore(getDatabase());
  const snapshot = store.getActiveSnapshot();
  if (!snapshot) {
    return NextResponse.json({ ok: true, items: [], total: 0 });
  }

  const registry = loadSourceRegistry();
  const common = loadCommonPreset();
  // Packages that cannot be installed alongside the rest of the image stay out
  // of the picker entirely; the planner reports the same list if one slips in
  // through a preset or an old saved config.
  const blocked = loadBlockedPackages();
  const result = store.searchPackages(snapshot.id, { query, limit: includeExtension ? limit * 2 : limit });

  const items: SearchItem[] = [];
  for (const pkg of result.items) {
    if (blocked.has(pkg.name)) continue;
    const record = registry.lookup(pkg.name);
    const applicability = packageApplicability(pkg.name, { common, registry, targetId, kernelLine });
    if (!applicability.allowed) continue;
    items.push({
      name: pkg.name,
      description: pkg.description,
      source: pkg.source,
      license: pkg.license,
      i18nStatus: statusOf(record),
      applies: true,
      reason: null,
    });
  }

  if (includeExtension) {
    const needle = query.toLowerCase();
    for (const entry of registry.list()) {
      if (entry.source !== "extension") continue;
      if (blocked.has(entry.name)) continue;
      if (items.some((item) => item.name === entry.name)) continue;
      const haystack = [entry.name, entry.i18n?.title ?? "", entry.i18n?.description ?? "", entry.repo ?? ""]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(needle)) continue;
      const applicability = packageApplicability(entry.name, { common, registry, targetId, kernelLine });
      if (!applicability.allowed) continue;
      items.push({
        name: entry.name,
        description: entry.i18n?.description ?? entry.i18n?.title ?? `扩展包 ${entry.name}`,
        source: "extension",
        license: entry.license ?? null,
        i18nStatus: statusOf(entry),
        applies: true,
        reason: null,
      });
      if (items.length >= limit) break;
    }
  }

  const sliced = items.slice(0, limit);
  return NextResponse.json({ ok: true, items: sliced, total: items.length });
}
