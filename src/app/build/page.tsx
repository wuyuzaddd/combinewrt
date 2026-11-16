import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/current-session";
import { getDatabase } from "@/lib/db";
import { createBaseVersionStore } from "@/lib/base/store";
import { createCatalogStore } from "@/lib/catalog/store";
import { loadCapabilities } from "@/lib/catalog/capabilities";
import { loadCommonPreset } from "@/lib/presets/common";
import { loadExtensionBundles } from "@/lib/extension/bundles";
import { loadExtensionThemes } from "@/lib/extension/themes";
import { loadSourceRegistry } from "@/lib/sources/registry";
import { loadModeDeclarations } from "@/lib/build/modes";
import { createBuildUiOptions } from "@/lib/build/ui-options";
import { getBuildService } from "@/lib/builds";
import { getSourceWatchService } from "@/lib/source-watch";
import { readSourcePin } from "@/lib/source-watch/store";
import { getSupplementWatchService } from "@/lib/supplement-watch";
import { BuildForm } from "./build-form";
import type { ReleaseOption } from "./form-model";
import type { SourceWatchSummary } from "./source-watch-panel";

function safeRead<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch (error) {
    console.error("[combinewrt] build page read failed", error);
    return fallback;
  }
}

function releaseOptions(baseVersions: ReturnType<ReturnType<typeof createBaseVersionStore>["list"]>, active: string, availableVersion: string): ReleaseOption[] {
  const versions = baseVersions.filter((entry) => entry.channel === "release");
  const usable = versions.length > 0 ? versions : baseVersions.filter((entry) => entry.version === active);
  const mapped = usable.map((entry) => ({
    version: entry.version,
    active: entry.version === active,
    snapshotAvailable: entry.version === availableVersion || entry.version === active ? true : false,
  }));
  return mapped.length > 0
    ? mapped
    : [{ version: availableVersion, active: true, snapshotAvailable: true }];
}

export default async function BuildPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login?next=/build");
  const { from } = await searchParams;
  const initialConfig = from ? (getBuildService().get(from)?.config ?? null) : null;

  const db = getDatabase();
  const store = createCatalogStore(db);
  const baseStore = createBaseVersionStore(db);
  const snapshot = store.getActiveSnapshot();

  if (!snapshot) {
    return (
      <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-6 py-12">
        <header>
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-400">build</p>
          <h1 className="mt-2 text-2xl font-semibold">固件构建</h1>
        </header>
        <section className="rounded-xl border border-amber-900/60 bg-amber-950/30 p-5 text-sm text-amber-200">
          还没有可用的目录快照。先到{" "}
          <Link className="underline" href="/catalog">
            软件包目录
          </Link>{" "}
          刷新一次。
        </section>
      </main>
    );
  }

  // Target/profile/variant decisions come from the checked-in capability
  // registry, never from the catalog snapshot or the browser.
  const registry = loadCapabilities();
  const sourceRegistry = loadSourceRegistry();
  const ui = createBuildUiOptions({
    registry,
    declarations: loadModeDeclarations(),
    bundles: loadExtensionBundles({ registry: sourceRegistry }),
    themes: loadExtensionThemes({ registry: sourceRegistry }),
    common: loadCommonPreset(),
  });

  const activeBase = baseStore.active();
  const releases = releaseOptions(
    baseStore.list(),
    activeBase?.version ?? snapshot.baseVersion,
    snapshot.baseVersion,
  ).map((release) => ({
    ...release,
    snapshotAvailable: release.snapshotAvailable || store.latestForBaseVersion(release.version) !== null,
  }));

  const dllkids = safeRead(() => getSourceWatchService().readOverview(), null);
  const supplement = safeRead(() => getSupplementWatchService().readOverview(), null);
  const extensionPin = safeRead(() => readSourcePin(db, "extension", "active"), null);
  const extensionCandidate = safeRead(() => readSourcePin(db, "extension", "candidate"), null);
  const sourceWatch: SourceWatchSummary = {
    dllkids: dllkids
      ? {
          activePin: dllkids.active?.value ?? null,
          candidatePin: dllkids.candidate?.value ?? null,
          lastCheckAt: dllkids.state.lastCheckAt,
          lastError: dllkids.state.lastError,
          candidateReason: dllkids.state.candidateReason,
          note: dllkids.note,
          history: dllkids.history.slice(0, 5).map((event) => ({
            reason: event.reason,
            toPin: event.toPin,
            createdAt: event.createdAt,
          })),
        }
      : null,
    supplement: supplement
      ? {
          activeCommit: supplement.active?.commit ?? null,
          candidateCommit: supplement.candidate?.commit ?? null,
          lastCheckAt: supplement.state.lastCheckAt,
          lastError: supplement.state.lastError,
          publishes: supplement.publishes.slice(0, 5).map((publish) => ({
            status: publish.status,
            publishMode: publish.publishMode,
            indexSha256: publish.indexSha256,
            keyFingerprint: publish.keyFingerprint,
            frozenPath: publish.frozenPath,
            updatedAt: publish.updatedAt,
          })),
        }
      : null,
    extension: {
      activePin: extensionPin?.value ?? null,
      candidatePin: extensionCandidate?.value ?? null,
    },
    pins: {
      dllkids: snapshot.sourcePins.dllkids,
      supplementCommit: snapshot.sourcePins.supplement?.commit ?? null,
      supplementFingerprint: snapshot.sourcePins.supplement?.fingerprint ?? null,
      kernel: snapshot.sourcePins.kernel,
      official: snapshot.sourcePins.official,
    },
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-400">build</p>
          <h1 className="mt-2 text-2xl font-semibold">固件构建</h1>
          <p className="mt-1 text-sm text-slate-400">
            默认使用 Simple 模式完成日常构建；内核线、模式叠加、网络 typed 字段与来源监视在 Advanced 中。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <Link className="text-slate-300 underline decoration-slate-600" href="/builds">
            构建历史
          </Link>
          <Link className="text-slate-300 underline decoration-slate-600" href="/catalog">
            软件包目录
          </Link>
        </div>
      </header>

      <BuildForm
        ui={ui}
        releases={releases}
        baseVersion={snapshot.baseVersion}
        initialConfig={initialConfig}
        sourceWatch={sourceWatch}
        fromBuildId={from ?? null}
      />
    </main>
  );
}
