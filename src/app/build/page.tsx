import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/current-session";
import { getDatabase } from "@/lib/db";
import { createCatalogStore } from "@/lib/catalog/store";
import { BuildForm } from "./build-form";

export default async function BuildPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/build");

  const store = createCatalogStore(getDatabase());
  const snapshot = store.getActiveSnapshot();
  const profiles = snapshot ? store.listProfiles(snapshot.id) : [];

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-6 py-12">
      <header>
        <p className="text-xs uppercase tracking-[0.2em] text-emerald-400">build</p>
        <h1 className="mt-2 text-2xl font-semibold">固件构建</h1>
        <p className="mt-1 text-sm text-slate-400">
          选择镜像格式与软件包，生成构建计划。真正的构建在 ticket 04/05 接入。
        </p>
      </header>

      {snapshot ? (
        <BuildForm baseVersion={snapshot.baseVersion} profiles={profiles} />
      ) : (
        <section className="rounded-xl border border-amber-900/60 bg-amber-950/30 p-5 text-sm text-amber-200">
          还没有可用的目录快照。先到{" "}
          <Link className="underline" href="/catalog">
            软件包目录
          </Link>{" "}
          刷新一次。
        </section>
      )}
    </main>
  );
}
