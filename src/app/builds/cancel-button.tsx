"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function CancelButton({ buildId }: { buildId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function cancel() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/builds/${buildId}/cancel`, { method: "POST" });
      if (response.status === 401) {
        router.push(`/login?next=/builds/${buildId}`);
        return;
      }
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "取消失败");
        return;
      }
      router.refresh();
    } catch {
      setError("取消失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex items-center gap-2">
      {error && <span className="text-xs text-rose-300">{error}</span>}
      <button
        className="rounded-lg border border-rose-800 px-3 py-1 text-xs text-rose-200 disabled:opacity-50"
        disabled={busy}
        onClick={cancel}
        type="button"
      >
        {busy ? "取消中…" : "取消构建"}
      </button>
    </span>
  );
}
