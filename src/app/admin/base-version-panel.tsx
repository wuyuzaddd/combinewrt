"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { BaseVersionState } from "@/lib/base/types";

const PHASE_LABELS: Record<string, string> = {
  refreshing: "刷新目录中",
  building: "冒烟构建中",
  succeeded: "冒烟成功",
  failed: "冒烟失败",
};

function formatDate(value: string | null): string {
  if (!value) return "未知";
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : date.toISOString().slice(0, 10);
}

export function BaseVersionPanel({ state }: { state: BaseVersionState }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"check" | "bump" | "revert" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (state.smoke?.phase !== "refreshing" && state.smoke?.phase !== "building") return;
    const timer = setInterval(() => router.refresh(), 5_000);
    return () => clearInterval(timer);
  }, [router, state.smoke?.phase]);

  async function post(path: string, body?: unknown) {
    const response = await fetch(path, {
      method: "POST",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  }

  async function run(action: "check" | "bump" | "revert") {
    setBusy(action);
    setError(null);
    try {
      if (action === "check") await post("/api/admin/base-version/check");
      if (action === "bump" && state.candidate) {
        await post("/api/admin/base-version", { action: "bump", version: state.candidate.version });
      }
      if (action === "revert") await post("/api/admin/base-version", { action: "revert" });
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">基础版本</h2>
          <p className="mt-1 text-xs text-slate-500">采用新版本前先检查；采用后自动刷新目录并跑一次冒烟构建。</p>
        </div>
        <button
          className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 disabled:opacity-50"
          disabled={busy !== null}
          onClick={() => run("check")}
          type="button"
        >
          {busy === "check" ? "检查中…" : "检查新版本"}
        </button>
      </div>

      {state.active ? (
        <dl className="mt-4 grid gap-2 sm:grid-cols-[8rem_1fr]">
          <dt className="text-slate-500">当前基线</dt>
          <dd className="font-mono text-emerald-300">{state.active.version}</dd>
          <dt className="text-slate-500">发布日期</dt>
          <dd>{formatDate(state.active.releaseDate)}</dd>
          <dt className="text-slate-500">ImageBuilder</dt>
          <dd className="break-all">
            <a className="text-emerald-300 underline decoration-emerald-800" href={state.active.imageBuilderUrl}>
              {state.active.imageBuilderUrl}
            </a>
          </dd>
          <dt className="text-slate-500">校验和</dt>
          <dd className="break-all font-mono text-xs">{state.active.imageBuilderSha256}</dd>
        </dl>
      ) : (
        <p className="mt-3 text-amber-300">数据库里还没有基础版本记录。</p>
      )}

      {state.check && (
        <p className="mt-3 text-xs text-slate-500">
          上次检查 {new Date(state.check.checkedAt).toLocaleString("zh-CN")}
          {state.check.error && <span className="text-rose-300"> · 检查失败：{state.check.error}</span>}
        </p>
      )}

      {state.candidate && (
        <div className="mt-4 rounded-lg border border-amber-800/60 bg-amber-950/30 p-3">
          <p className="text-amber-200">
            发现新版本 <span className="font-mono">{state.candidate.version}</span>（
            {formatDate(state.candidate.releaseDate)}），不会自动采用。
          </p>
          <p className="mt-1 break-all text-xs text-amber-100/70">{state.candidate.imageBuilderUrl}</p>
          <button
            className="mt-3 rounded bg-amber-500 px-3 py-1.5 text-xs font-medium text-slate-950 disabled:opacity-50"
            disabled={busy !== null}
            onClick={() => run("bump")}
            type="button"
          >
            {busy === "bump" ? "采用中…" : `采用 ${state.candidate.version}`}
          </button>
        </div>
      )}

      {state.smoke && (
        <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
          <p className={state.smoke.phase === "failed" ? "text-rose-300" : "text-slate-300"}>
            冒烟状态：{PHASE_LABELS[state.smoke.phase] ?? state.smoke.phase}
            {state.smoke.targetVersion && (
              <span className="ml-2 font-mono text-xs text-slate-500">目标 {state.smoke.targetVersion}</span>
            )}
            {state.smoke.updatedAt && (
              <span className="ml-2 text-xs text-slate-500">
                {new Date(state.smoke.updatedAt).toLocaleString("zh-CN")}
              </span>
            )}
          </p>
          {state.smoke.error && <p className="mt-1 break-words text-xs text-rose-300">{state.smoke.error}</p>}
          {state.smoke.buildId && (
            <p className="mt-1 text-xs">
              <Link className="text-emerald-300 underline decoration-emerald-800" href={`/builds/${state.smoke.buildId}`}>
                查看冒烟构建
              </Link>
            </p>
          )}
        </div>
      )}

      {state.supplementBuild && (
        <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
          <p className={state.supplementBuild.error ? "text-rose-300" : "text-slate-300"}>
            补充包构建：
            {state.supplementBuild.error
              ? "触发失败"
              : `已触发（${new Date(state.supplementBuild.triggeredAt).toLocaleString("zh-CN")}）`}
            <span className="ml-2 font-mono text-xs text-slate-500">
              基线 {state.supplementBuild.baseVersion}
            </span>
          </p>
          {state.supplementBuild.error && (
            <p className="mt-1 break-words text-xs text-rose-300">{state.supplementBuild.error}</p>
          )}
        </div>
      )}

      {state.previous && (
        <button
          className="mt-4 rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 disabled:opacity-50"
          disabled={busy !== null}
          onClick={() => run("revert")}
          type="button"
        >
          {busy === "revert" ? "回滚中…" : `回滚到 ${state.previous.version}`}
        </button>
      )}

      {error && <p className="mt-3 break-words text-xs text-rose-300">{error}</p>}
    </section>
  );
}
