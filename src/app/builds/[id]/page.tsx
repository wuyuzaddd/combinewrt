import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth/current-session";
import { getBuildService } from "@/lib/builds";
import { BuildPoller } from "./build-poller";

export default async function BuildDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect(`/login?next=/builds/${id}`);
  const build = await getBuildService().refresh(id);
  if (!build) notFound();

  const active = build.status === "queued" || build.status === "running";

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-6 py-12">
      <BuildPoller active={active} />
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-400">build</p>
          <h1 className="mt-2 break-all font-mono text-lg font-semibold">{build.plan.artifactName}</h1>
          <p className="mt-1 text-xs text-slate-500">
            {build.plan.profileTitle} · {build.plan.imageType} · {build.adapter} · run {build.runId ?? "—"}
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-200">{build.status}</span>
          <Link className="text-slate-400" href="/builds">
            返回
          </Link>
        </div>
      </header>

      {build.error && (
        <p className="rounded-xl border border-rose-900 bg-rose-950/40 p-4 text-sm text-rose-200">{build.error}</p>
      )}

      {build.status === "succeeded" && build.artifactName && (
        <a
          className="w-fit rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-emerald-950"
          href={`/api/builds/${build.id}/artifact`}
        >
          下载产物（{build.artifactName}）
        </a>
      )}

      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <p className="text-xs uppercase tracking-wider text-slate-500">日志尾部</p>
        <pre className="mt-2 max-h-96 overflow-auto rounded bg-slate-950 p-3 text-xs text-slate-300">
          {build.logTail || "（暂无日志）"}
        </pre>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm">
          <p className="text-xs uppercase tracking-wider text-slate-500">软件包（{build.plan.packages.length}）</p>
          <p className="mt-1 break-all text-slate-300">{build.plan.packages.join(", ")}</p>
          <p className="mt-3 text-xs text-slate-500">来源</p>
          <p className="break-all text-xs text-slate-400">{build.plan.sourceNote}</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm">
          <p className="text-xs uppercase tracking-wider text-slate-500">生成文件</p>
          {build.plan.files.map((file) => (
            <p className="mt-1 break-all font-mono text-xs text-emerald-300" key={file.path}>
              {file.path}
            </p>
          ))}
        </div>
      </section>
    </main>
  );
}
