"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RefreshButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/catalog/refresh", { method: "POST" });
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        created?: boolean;
        snapshot?: { id: number };
      };
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setMessage(data.created ? `已生成快照 #${data.snapshot?.id}` : `快照已是最新（#${data.snapshot?.id}）`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "刷新失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        className="rounded-lg border border-emerald-500/60 bg-emerald-500/10 px-3 py-1.5 text-sm text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
        disabled={pending}
        onClick={refresh}
        type="button"
      >
        {pending ? "刷新中…" : "刷新目录"}
      </button>
      {message ? <p className="max-w-xs text-right text-xs text-slate-400">{message}</p> : null}
    </div>
  );
}
