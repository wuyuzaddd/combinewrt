import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/current-session";
import { getBuildService } from "@/lib/builds";

const STATUS_STYLES: Record<string, string> = {
  queued: "bg-slate-800 text-slate-200",
  running: "bg-amber-950 text-amber-200",
  succeeded: "bg-emerald-950 text-emerald-200",
  failed: "bg-rose-950 text-rose-200",
  cancelled: "bg-slate-800 text-slate-400",
};

const PAGE_SIZE = 20;

export default async function BuildsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login?next=/builds");

  const { page: pageParam } = await searchParams;
  const requested = Math.max(1, Number(pageParam) || 1);

  const service = getBuildService();
  await service.refreshActive(20);
  const total = service.count();
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requested, pages);
  const builds = service.list(PAGE_SIZE, (page - 1) * PAGE_SIZE);

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-6 py-12">
      <header className="flex items-baseline justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-400">builds</p>
          <h1 className="mt-2 text-2xl font-semibold">构建历史</h1>
          <p className="mt-1 text-xs text-slate-500">
            共 {total} 条 · 第 {page}/{pages} 页
          </p>
        </div>
        <div className="flex gap-4 text-sm">
          <Link className="text-emerald-300 underline decoration-emerald-800" href="/build">
            新建构建
          </Link>
          <Link className="text-slate-400" href="/admin">
            管理台
          </Link>
        </div>
      </header>

      {builds.length === 0 ? (
        <p className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 text-sm text-slate-400">
          还没有构建。去 <Link className="text-emerald-300 underline" href="/build">新建构建</Link>。
        </p>
      ) : (
        <ul className="space-y-3">
          {builds.map((build) => (
            <li key={build.id}>
              <Link
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4 hover:border-emerald-700"
                href={`/builds/${build.id}`}
              >
                <div>
                  <p className="font-mono text-sm text-slate-200">{build.plan.artifactName}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {build.plan.profileTitle} · {build.plan.imageType} ·{" "}
                    {build.config
                      ? `${build.config.hostname} / ${build.config.lanIp}`
                      : "旧记录无表单配置"}{" "}
                    · {new Date(build.createdAt).toLocaleString("zh-CN")}
                  </p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs ${STATUS_STYLES[build.status] ?? "bg-slate-800"}`}>
                  {build.status}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {pages > 1 && (
        <nav className="flex justify-between text-sm">
          {page > 1 ? (
            <Link className="text-emerald-300 underline decoration-emerald-800" href={`/builds?page=${page - 1}`}>
              ← 上一页
            </Link>
          ) : (
            <span />
          )}
          {page < pages ? (
            <Link className="text-emerald-300 underline decoration-emerald-800" href={`/builds?page=${page + 1}`}>
              下一页 →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </main>
  );
}
