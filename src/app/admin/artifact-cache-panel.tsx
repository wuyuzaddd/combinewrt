import type { ArtifactCacheStats } from "@/lib/builds/artifact-store";
import type { RetentionSummary } from "@/lib/builds/retention";
import { formatBytes } from "@/lib/image/postprocess";

/**
 * Admin visibility for the site artifact cache (ticket 14): current size, the
 * last cleanup (count and bytes), and why the last failure happened. Cleanup
 * only evicts cached files — build history and manifests stay in SQLite.
 */
export function ArtifactCachePanel({
  stats,
  retention,
  retentionDays,
  maxBytes,
}: {
  stats: ArtifactCacheStats;
  retention: RetentionSummary | null;
  retentionDays: number;
  maxBytes: number;
}) {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 text-sm">
      <h2 className="font-medium">产物缓存</h2>
      <p className="mt-1 text-slate-400">
        当前缓存 {stats.entries} 个文件 · {formatBytes(stats.bytes)}
      </p>
      {retention ? (
        <p className="mt-1 text-slate-400">
          上次清理 {new Date(retention.at).toLocaleString("zh-CN")} · 删除 {retention.removed} 个文件
          {typeof retention.removedBytes === "number" && retention.removedBytes > 0
            ? `（${formatBytes(retention.removedBytes)}）`
            : ""}
          {retention.failed.length > 0 && (
            <span className="text-amber-300"> · {retention.failed.length} 个文件清理失败</span>
          )}
          {retention.error && <span className="text-rose-300"> · 清理运行失败：{retention.error}</span>}
        </p>
      ) : (
        <p className="mt-1 text-slate-500">尚未运行清理。</p>
      )}
      {retention && retention.failed.length > 0 && (
        <p className="mt-1 break-words text-xs text-amber-300">失败原因：{retention.failed[0]}</p>
      )}
      <p className="mt-2 text-xs text-slate-500">
        保留 {retentionDays} 天；缓存上限 {maxBytes > 0 ? formatBytes(maxBytes) : "不限制"}
        ，超出时按最旧优先清理。清理只删缓存文件，不删构建历史或清单。
      </p>
    </section>
  );
}
