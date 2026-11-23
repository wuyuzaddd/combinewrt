"use client";

import Link from "next/link";

/**
 * Advanced-mode source-watch summary (ticket 15).
 *
 * Read-only view of the pins/candidates/last check and the supplement
 * staging-vs-live publish state (tickets 10/11). It links to the build list and,
 * when the form was opened from an existing build, to that build's detail and
 * source offer. No credential or key material is rendered.
 */
export interface SourceWatchSummary {
  dllkids: {
    activePin: string | null;
    candidatePin: string | null;
    lastCheckAt: string | null;
    lastError: string | null;
    candidateReason: string | null;
    note: string;
    history: Array<{ reason: string; toPin: string | null; createdAt: string }>;
  } | null;
  supplement: {
    activeCommit: string | null;
    candidateCommit: string | null;
    lastCheckAt: string | null;
    lastError: string | null;
    publishes: Array<{
      status: string;
      publishMode: string;
      indexSha256: string | null;
      keyFingerprint: string | null;
      frozenPath: string | null;
      updatedAt: string;
    }>;
  } | null;
  extension: { activePin: string | null; candidatePin: string | null };
  pins: {
    dllkids: string | null;
    supplementCommit: string | null;
    supplementFingerprint: string | null;
    kernel: { version: string; release: string; vermagic: string } | null;
    official: Record<string, string>;
  };
}

function short(value: string | null): string {
  return value ? `${value.slice(0, 12)}…` : "—";
}

function formatTime(value: string | null): string {
  return value ? new Date(value).toLocaleString("zh-CN") : "尚未检查";
}

const REASON_LABELS: Record<string, string> = {
  unchanged: "无变化",
  safe_change: "上游更新，已自动采纳",
  same_version_hash_changed: "同版本哈希变化（需人工确认）",
  upstream_changed_auto_adopt: "上游内容变化，已自动采纳",
  auto_adopted_same_version_hash: "上游内容变化，已自动采纳",
  baseline_missing: "缺少基线缓存，已阻止",
  adoption_failed: "采纳失败",
};

export function SourceWatchPanel({
  sourceWatch,
  fromBuildId,
}: {
  sourceWatch: SourceWatchSummary;
  fromBuildId: string | null;
}) {
  const pins = sourceWatch.pins;
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">来源监视与当前 pin</h2>
          <p className="mt-1 text-xs text-slate-500">
            来源监视每 6 小时运行一次；固定 pin 是本次构建的可复现身份。候选 pin 不会自动进入正在编辑的计划。
          </p>
        </div>
        <div className="flex flex-wrap gap-3 text-xs">
          <Link className="text-emerald-300 underline decoration-emerald-800" href="/builds">
            构建详情
          </Link>
          {fromBuildId ? (
            <>
              <Link
                className="text-emerald-300 underline decoration-emerald-800"
                href={`/builds/${fromBuildId}`}
              >
                当前构建
              </Link>
              <Link
                className="text-emerald-300 underline decoration-emerald-800"
                href={`/builds/${fromBuildId}/source-offer`}
              >
                当前 source offer
              </Link>
            </>
          ) : null}
        </div>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <article className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
          <h3 className="text-xs uppercase tracking-wider text-slate-500">dllkids 索引</h3>
          <p className="mt-1 break-all font-mono text-xs text-slate-300">active {short(pins.dllkids)}</p>
          {sourceWatch.dllkids ? (
            <>
              <p className="mt-1 text-xs text-slate-500">上次检查 {formatTime(sourceWatch.dllkids.lastCheckAt)}</p>
              <p className="mt-1 break-all font-mono text-xs text-slate-400">
                候选 {short(sourceWatch.dllkids.candidatePin)}
              </p>
              {sourceWatch.dllkids.candidateReason ? (
                <p className="mt-1 text-xs text-amber-300">
                  {REASON_LABELS[sourceWatch.dllkids.candidateReason] ?? sourceWatch.dllkids.candidateReason}
                </p>
              ) : null}
              {sourceWatch.dllkids.lastError ? (
                <p className="mt-1 break-all text-xs text-rose-300">{sourceWatch.dllkids.lastError}</p>
              ) : null}
              {sourceWatch.dllkids.history.length > 0 ? (
                <ul className="mt-2 space-y-0.5 text-[11px] text-slate-500">
                  {sourceWatch.dllkids.history.map((event, index) => (
                    <li key={`${event.createdAt}-${index}`}>
                      {event.reason} · {short(event.toPin)}
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="mt-2 text-[11px] text-slate-500">{sourceWatch.dllkids.note}</p>
            </>
          ) : (
            <p className="mt-1 text-xs text-slate-500">来源监视尚未初始化。</p>
          )}
        </article>

        <article className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
          <h3 className="text-xs uppercase tracking-wider text-slate-500">supplement 发布</h3>
          <p className="mt-1 break-all font-mono text-xs text-slate-300">active {short(pins.supplementCommit)}</p>
          <p className="mt-1 break-all font-mono text-[11px] text-slate-500">
            签名 {short(pins.supplementFingerprint)}
          </p>
          {sourceWatch.supplement ? (
            <>
              <p className="mt-1 text-xs text-slate-500">上次检查 {formatTime(sourceWatch.supplement.lastCheckAt)}</p>
              <p className="mt-1 break-all font-mono text-xs text-slate-400">
                候选 {short(sourceWatch.supplement.candidateCommit)}
              </p>
              {sourceWatch.supplement.lastError ? (
                <p className="mt-1 break-all text-xs text-rose-300">{sourceWatch.supplement.lastError}</p>
              ) : null}
              {sourceWatch.supplement.publishes.length > 0 ? (
                <ul className="mt-2 space-y-1 text-[11px] text-slate-400">
                  {sourceWatch.supplement.publishes.map((publish, index) => (
                    <li key={`${publish.updatedAt}-${index}`}>
                      <span
                        className={
                          publish.publishMode === "live" ? "text-emerald-300" : "text-amber-300"
                        }
                      >
                        {publish.publishMode === "live" ? "live" : "staging"}
                      </span>{" "}
                      · {publish.status} · index {short(publish.indexSha256)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-xs text-slate-500">还没有 supplement 发布记录。</p>
              )}
            </>
          ) : (
            <p className="mt-1 text-xs text-slate-500">supplement 监视尚未初始化。</p>
          )}
        </article>

        <article className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
          <h3 className="text-xs uppercase tracking-wider text-slate-500">extension 与内核 pin</h3>
          <p className="mt-1 break-all font-mono text-xs text-slate-300">
            extension {short(sourceWatch.extension.activePin)}
          </p>
          <p className="mt-1 break-all font-mono text-xs text-slate-400">
            候选 {short(sourceWatch.extension.candidatePin)}
          </p>
          <p className="mt-2 break-all font-mono text-xs text-slate-300">
            kernel{" "}
            {pins.kernel
              ? `${pins.kernel.version}-${pins.kernel.release} · ${pins.kernel.vermagic}`
              : "未记录"}
          </p>
          <div className="mt-2 space-y-0.5 break-all font-mono text-[11px] text-slate-500">
            {Object.entries(pins.official).length > 0 ? (
              Object.entries(pins.official).map(([feed, pin]) => (
                <p key={feed}>
                  {feed}: {pin}
                </p>
              ))
            ) : (
              <p>官方 feed pin 未记录</p>
            )}
          </div>
        </article>
      </div>
    </section>
  );
}
