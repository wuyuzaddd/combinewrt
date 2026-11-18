"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type {
  PackageDiff,
  PinEventReason,
  SourcePinRecord,
  SourceWatchOverview,
} from "@/lib/source-watch/types";

const REASON_LABELS: Record<PinEventReason, string> = {
  adopted: "自动采纳",
  adopted_forced: "强制采纳",
  adopted_bootstrap: "首次观察，引导采纳",
  blocked_same_version_hash: "同版本哈希变化，已阻止",
  blocked_baseline_missing: "缺少基线缓存，已阻止",
  adoption_rolled_back: "刷新失败，已回滚",
  rolled_back: "手动回滚",
  supplement_auto_published: "补充源自动发布",
};

const STATE_LABELS: Record<string, string> = {
  safe_change: "发现安全变更",
  same_version_hash_changed: "同版本哈希变化",
  baseline_missing: "缺少基线缓存",
  adoption_failed: "采纳失败",
  unchanged: "无变化",
  supplement_live_dispatched: "补充源：已派发自动发布构建",
  supplement_staging_dispatched: "补充源：元数据变化，已派发 staging 构建",
  supplement_staged: "补充源：已进入 staging，等待人工提升",
  supplement_dispatch_failed: "补充源：派发失败",
  supplement_skipped: "补充源：该 commit 已处理",
};

function shortPin(value: string | null): string {
  if (!value) return "—";
  return value.length > 16 ? `${value.slice(0, 12)}…` : value;
}

function formatTime(value: string | null): string {
  if (!value) return "未知";
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toLocaleString("zh-CN") : value;
}

function diffLine(diff: PackageDiff): string {
  return `新增 ${diff.added.length} · 移除 ${diff.removed.length} · 升级 ${diff.upgraded.length} · 降级 ${diff.downgraded.length}`;
}

function PinRow({ label, pin }: { label: string; pin: SourcePinRecord | null }) {
  if (!pin) {
    return (
      <div className="flex flex-wrap items-baseline gap-2 py-1">
        <span className="w-16 shrink-0 text-slate-500">{label}</span>
        <span className="text-slate-500">尚无</span>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-baseline gap-2 py-1">
      <span className="w-16 shrink-0 text-slate-500">{label}</span>
      <span className="font-mono text-emerald-300" title={pin.value}>
        {shortPin(pin.value)}
      </span>
      {pin.status === "active" && pin.adoptedBy && (
        <span className="text-xs text-slate-500">由 {pin.adoptedBy} 采纳</span>
      )}
      {pin.observedAt && <span className="text-xs text-slate-500">观察于 {formatTime(pin.observedAt)}</span>}
      {typeof pin.metadata.snapshotId === "number" && (
        <span className="text-xs text-slate-500">快照 #{pin.metadata.snapshotId}</span>
      )}
      {pin.metadata.blocked === true && (
        <span className="rounded bg-amber-900/60 px-1.5 py-0.5 text-[10px] text-amber-300">已阻止</span>
      )}
    </div>
  );
}

export function SourceWatchPanel({ overview }: { overview: SourceWatchOverview }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const candidate = overview.candidate;
  const blocked = candidate?.metadata.blocked === true;
  const blockedReason =
    typeof candidate?.metadata.blockedReason === "string"
      ? candidate.metadata.blockedReason
      : "same_version_hash_changed";
  const baselineMissing = blocked && blockedReason === "baseline_missing";

  async function run(action: "check" | "adopt" | "rollback", force = false) {
    const prompt = baselineMissing
      ? "缺少上一 pin 的缓存索引，无法校验同版本哈希变化。强制采纳将跳过该校验，继续？"
      : "同版本包哈希发生变化，强制采纳可能引入被篡改或不稳定的包。继续？";
    if (force && !window.confirm(prompt)) {
      return;
    }
    setBusy(action);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/source-watch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, force }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string; result?: { error?: string } };
      if (!response.ok) {
        throw new Error(
          data.error ?? data.result?.error ?? `HTTP ${response.status}`,
        );
      }
      setNotice(
        action === "check" ? "检查完成。" : action === "adopt" ? "已采纳候选 pin 并刷新目录。" : "已回滚 pin 并刷新目录。",
      );
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
          <h2 className="font-medium">源固定（dllkids）</h2>
          <p className="mt-1 text-xs text-slate-500">
            每 {Math.round(overview.intervalMs / 3_600_000)} 小时检查一次索引；安全变更自动采纳，同版本包哈希变化只告警。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 disabled:opacity-50"
            disabled={busy !== null}
            onClick={() => run("check")}
            type="button"
          >
            {busy === "check" ? "检查中…" : "立即检查"}
          </button>
          <button
            className="rounded border border-emerald-800 px-3 py-1.5 text-xs text-emerald-300 disabled:opacity-50"
            disabled={busy !== null || !candidate}
            onClick={() => run("adopt", blocked)}
            type="button"
          >
            {busy === "adopt" ? "采纳中…" : blocked ? "强制采纳候选" : "采纳候选"}
          </button>
          <button
            className="rounded border border-amber-800 px-3 py-1.5 text-xs text-amber-300 disabled:opacity-50"
            disabled={busy !== null || !overview.rollbackTarget}
            onClick={() => run("rollback")}
            type="button"
          >
            {busy === "rollback" ? "回滚中…" : "回滚上一 pin"}
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
        <PinRow label="当前 pin" pin={overview.active} />
        <PinRow label="候选 pin" pin={candidate} />
        {overview.rollbackTarget && (
          <div className="flex flex-wrap items-baseline gap-2 py-1">
            <span className="w-16 shrink-0 text-slate-500">可回滚到</span>
            <span className="font-mono text-slate-300" title={overview.rollbackTarget.value}>
              {shortPin(overview.rollbackTarget.value)}
            </span>
            {overview.rollbackTarget.observedAt && (
              <span className="text-xs text-slate-500">{formatTime(overview.rollbackTarget.observedAt)}</span>
            )}
          </div>
        )}
      </div>

      <p className="mt-3 text-xs text-slate-500">
        上次检查 {formatTime(overview.state.lastCheckAt)}
        {overview.state.lastSuccessAt && <> · 上次成功 {formatTime(overview.state.lastSuccessAt)}</>}
        {overview.state.candidateReason && (
          <> · {STATE_LABELS[overview.state.candidateReason] ?? overview.state.candidateReason}</>
        )}
      </p>
      {overview.state.lastError && (
        <p className="mt-1 break-words text-xs text-rose-300">最近错误：{overview.state.lastError}</p>
      )}

      {candidate && blocked && (
        <div className="mt-4 rounded-lg border border-amber-800/60 bg-amber-950/30 p-3 text-amber-100">
          <p className="text-amber-200">
            {baselineMissing
              ? "缺少上一 pin 的缓存索引，无法校验同版本哈希变化，已阻止自动采纳。"
              : "同版本包哈希发生变化，已阻止自动采纳。"}
          </p>
          <ul className="mt-2 space-y-1 text-xs">
            {overview.diff?.sameVersionHashChanges.map((change) => (
              <li key={change.name}>
                <span className="font-mono">{change.name}</span> {change.version}：
                <span className="font-mono">{change.from.slice(0, 12)}…</span> →{" "}
                <span className="font-mono">{change.to.slice(0, 12)}…</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-amber-200/70">确认上游重新构建无误后，可强制采纳。</p>
        </div>
      )}

      {candidate && overview.diff && (
        <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
          <p className="text-xs font-medium text-slate-400">候选差异</p>
          <p className="mt-1 text-xs text-slate-300">{diffLine(overview.diff)}</p>
          <div className="mt-2 grid gap-2 text-xs text-slate-400 sm:grid-cols-2">
            {overview.diff.added.length > 0 && (
              <p className="break-words">
                <span className="text-emerald-300">新增：</span>
                {overview.diff.added.slice(0, 12).join("、")}
                {overview.diff.added.length > 12 && ` 等 ${overview.diff.added.length} 个`}
              </p>
            )}
            {overview.diff.removed.length > 0 && (
              <p className="break-words">
                <span className="text-rose-300">移除：</span>
                {overview.diff.removed.slice(0, 12).join("、")}
                {overview.diff.removed.length > 12 && ` 等 ${overview.diff.removed.length} 个`}
              </p>
            )}
            {overview.diff.upgraded.length > 0 && (
              <p className="break-words">
                <span className="text-sky-300">升级：</span>
                {overview.diff.upgraded
                  .slice(0, 8)
                  .map((item) => `${item.name} ${item.from}→${item.to}`)
                  .join("、")}
                {overview.diff.upgraded.length > 8 && ` 等 ${overview.diff.upgraded.length} 个`}
              </p>
            )}
            {overview.diff.downgraded.length > 0 && (
              <p className="break-words">
                <span className="text-amber-300">降级：</span>
                {overview.diff.downgraded
                  .slice(0, 8)
                  .map((item) => `${item.name} ${item.from}→${item.to}`)
                  .join("、")}
              </p>
            )}
          </div>
        </div>
      )}

      {overview.history.length > 0 && (
        <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
          <p className="text-xs font-medium text-slate-400">采纳 / 回滚历史</p>
          <ul className="mt-2 divide-y divide-slate-800">
            {overview.history.map((event) => (
              <li className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs" key={event.id}>
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-slate-300">{REASON_LABELS[event.reason] ?? event.reason}</span>
                  <span className="font-mono text-slate-500" title={event.fromPin ?? undefined}>
                    {shortPin(event.fromPin)} → {shortPin(event.toPin)}
                  </span>
                  {event.snapshotId !== null && <span className="text-slate-500">快照 #{event.snapshotId}</span>}
                </div>
                <span className="text-slate-500">{formatTime(event.createdAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {notice && <p className="mt-3 text-xs text-emerald-300">{notice}</p>}
      {error && <p className="mt-3 break-words text-xs text-rose-300">{error}</p>}
      <p className="mt-3 text-xs text-slate-500">{overview.note}</p>
    </section>
  );
}
