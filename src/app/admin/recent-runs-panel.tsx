"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { WorkflowRunSummary } from "@/lib/builds/github";

function stateLabel(run: WorkflowRunSummary): string {
  if (run.status !== "completed") return run.status === "in_progress" ? "运行中" : "排队中";
  if (run.conclusion === "success") return "成功";
  if (run.conclusion === "cancelled") return "已取消";
  return run.conclusion === "failure" ? "失败" : run.conclusion ?? "未知";
}

function stateClass(run: WorkflowRunSummary): string {
  if (run.status !== "completed") return "text-sky-300";
  return run.conclusion === "success" ? "text-emerald-300" : "text-rose-300";
}

export function RecentRunsPanel({
  runs,
  error,
}: {
  runs: WorkflowRunSummary[];
  error: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function refresh() {
    startTransition(() => router.refresh());
  }

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-medium">最近工作流运行</h2>
        <button
          className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 disabled:opacity-50"
          disabled={pending}
          onClick={refresh}
          type="button"
        >
          {pending ? "刷新中…" : "刷新"}
        </button>
      </div>
      <p className="mt-1 text-xs text-slate-500">镜像构建与 supplement 包构建；只展示元数据，不展示日志或计划内容。</p>

      {error ? (
        <p className="mt-3 break-words text-xs text-rose-300">{error}</p>
      ) : runs.length === 0 ? (
        <p className="mt-3 text-xs text-slate-500">暂无运行记录。</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-800">
          {runs.map((run) => (
            <li className="flex flex-wrap items-baseline justify-between gap-2 py-2" key={`${run.workflow}-${run.id}`}>
              <div className="min-w-0">
                <p className="truncate text-slate-200">{run.title || `#${run.id}`}</p>
                <p className="text-xs text-slate-500">
                  {run.workflow} · {new Date(run.createdAt).toLocaleString("zh-CN")}
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className={stateClass(run)}>{stateLabel(run)}</span>
                <a
                  className="text-emerald-300 underline decoration-emerald-800"
                  href={run.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  #{run.id}
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
