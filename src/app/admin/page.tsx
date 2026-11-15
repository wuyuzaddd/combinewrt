import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/current-session";
import { getConfig } from "@/lib/config";
import { getDatabase } from "@/lib/db";
import { readBaseVersionState } from "@/lib/base";
import { listWorkflowRuns, type WorkflowRunSummary } from "@/lib/builds/github";
import { readCatalogRefreshState } from "@/lib/catalog/refresh-control";
import { readRetentionSummary } from "@/lib/builds/retention";
import { BaseVersionPanel } from "./base-version-panel";
import { LogoutButton } from "./logout-button";
import { RecentRunsPanel } from "./recent-runs-panel";

const sections = [
  { title: "固件构建", body: "选择设备、镜像格式、软件包并预览构建计划。", href: "/build" },
  { title: "构建历史", body: "查看排队、运行、成功/失败记录并下载产物。", href: "/builds" },
  { title: "软件包目录", body: "浏览 ImmortalWrt 官方 feed 的目录快照。", href: "/catalog" },
];

async function loadRecentRuns(): Promise<{ runs: WorkflowRunSummary[]; error: string | null }> {
  const config = getConfig();
  if (config.buildAdapter !== "github" || !config.buildRepo || !config.buildRepoToken) {
    return { runs: [], error: "当前未启用 GitHub 构建适配器，无法读取工作流运行。" };
  }
  try {
    const [builds, packages] = await Promise.all([
      listWorkflowRuns({
        repo: config.buildRepo,
        token: config.buildRepoToken,
        workflow: config.buildWorkflow,
      }),
      listWorkflowRuns({
        repo: config.buildRepo,
        token: config.buildRepoToken,
        workflow: config.supplementWorkflow,
      }),
    ]);
    const runs = [...builds, ...packages]
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .slice(0, 10);
    return { runs, error: null };
  } catch (error) {
    return {
      runs: [],
      error: error instanceof Error ? error.message : "读取工作流运行失败",
    };
  }
}

export default async function AdminPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/admin");
  const retention = readRetentionSummary(getDatabase());
  const baseVersion = readBaseVersionState();
  const catalogRefresh = readCatalogRefreshState(getDatabase());
  const recentRuns = await loadRecentRuns();

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-8 px-6 py-12">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-400">admin</p>
          <h1 className="mt-2 text-2xl font-semibold">管理台</h1>
          <p className="mt-1 text-sm text-slate-400">已登录 · 会话有效期 7 天</p>
        </div>
        <LogoutButton />
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        {sections.map((section) => (
          <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5" key={section.title}>
            <h2 className="font-medium">
              {section.href ? (
                <Link className="text-emerald-300 underline decoration-emerald-800" href={section.href}>
                  {section.title}
                </Link>
              ) : (
                section.title
              )}
            </h2>
            <p className="mt-1 text-sm text-slate-400">{section.body}</p>
          </section>
        ))}
      </div>

      <BaseVersionPanel state={baseVersion} />

      <RecentRunsPanel error={recentRuns.error} runs={recentRuns.runs} />

      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 text-sm">
        <h2 className="font-medium">目录自动刷新</h2>
        {catalogRefresh.lastSuccessAt ? (
          <p className="mt-1 text-slate-400">
            上次成功 {new Date(catalogRefresh.lastSuccessAt).toLocaleString("zh-CN")} · 快照 #
            {catalogRefresh.snapshotId ?? "?"}
          </p>
        ) : (
          <p className="mt-1 text-slate-500">尚未成功刷新。</p>
        )}
        {catalogRefresh.lastAttemptAt && (
          <p className="mt-1 text-xs text-slate-500">
            上次尝试 {new Date(catalogRefresh.lastAttemptAt).toLocaleString("zh-CN")}
          </p>
        )}
        {catalogRefresh.lastError && (
          <p className="mt-2 break-words text-xs text-rose-300">刷新失败：{catalogRefresh.lastError}</p>
        )}
        <p className="mt-2 text-xs text-slate-500">每天最多自动刷新一次；手动刷新不受此限制。</p>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 text-sm">
        <h2 className="font-medium">产物清理</h2>
        {retention ? (
          <p className="mt-1 text-slate-400">
            上次清理 {new Date(retention.at).toLocaleString("zh-CN")} · 删除 {retention.removed} 个文件
            {retention.failed.length > 0 && (
              <span className="text-amber-300"> · {retention.failed.length} 个文件清理失败</span>
            )}
            {retention.error && <span className="text-rose-300"> · 清理运行失败：{retention.error}</span>}
          </p>
        ) : (
          <p className="mt-1 text-slate-500">尚未运行清理。</p>
        )}
        <p className="mt-2 text-xs text-slate-500">
          保留天数由 <code className="font-mono">ARTIFACT_RETENTION_DAYS</code> 控制；清理只删站点缓存，不删构建历史。
        </p>
      </section>
    </main>
  );
}
