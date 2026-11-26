"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface BuildRetryRowView {
  id: string;
  attempts: number;
  nextAttemptAt: string;
  lastBuildId: string | null;
  lastError: string | null;
  createdAt: string;
}

function formatTime(value: string): string {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toLocaleString("zh-CN") : value;
}

export function BuildRetriesPanel({ retries: initial }: { retries: BuildRetryRowView[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function act(action: "retry" | "cancel", id: string) {
    setBusy(id);
    setError("");
    try {
      const response = await fetch("/api/admin/build-retries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, id }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        retries?: BuildRetryRowView[];
        error?: string;
      };
      if (!response.ok) {
        setError(data.error ?? `操作失败（HTTP ${response.status}）`);
        return;
      }
      setRows(data.retries ?? []);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-slate-200">构建重试队列</h2>
        <span className="text-xs text-slate-500">
          下载 404（feed 滚动）自动重试：3 次后每 3 小时一轮，直到成功
        </span>
      </div>

      {error ? (
        <p className="mt-2 rounded border border-rose-900 bg-rose-950/40 p-2 text-xs text-rose-200">{error}</p>
      ) : null}

      {rows.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500">当前没有等待重试的构建。</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-800">
          {rows.map((row) => (
            <li className="flex flex-wrap items-center justify-between gap-2 py-2" key={row.id}>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-slate-300">
                  下次尝试 {formatTime(row.nextAttemptAt)} · 本轮已试 {row.attempts}/3 次
                </p>
                <p className="mt-0.5 break-all font-mono text-[11px] text-slate-500">
                  {row.lastBuildId ? `上次构建 ${row.lastBuildId.slice(0, 8)}` : "尚无重试构建"}
                  {row.lastError ? ` · ${row.lastError.slice(0, 160)}` : ""}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  className="rounded border border-emerald-800 px-2 py-1 text-xs text-emerald-300 disabled:opacity-50"
                  disabled={busy !== null}
                  onClick={() => act("retry", row.id)}
                  type="button"
                >
                  {busy === row.id ? "处理中…" : "立即重试"}
                </button>
                <button
                  className="rounded border border-rose-900 px-2 py-1 text-xs text-rose-300 disabled:opacity-50"
                  disabled={busy !== null}
                  onClick={() => act("cancel", row.id)}
                  type="button"
                >
                  取消
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
