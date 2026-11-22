"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface ConfigSummary {
  target: string;
  profile: string;
  release: string;
  variant: string;
  hostname: string;
  packages: number;
}

interface SavedConfig {
  id: string;
  name: string;
  sourceBuildId: string | null;
  createdAt: string;
  updatedAt: string;
  summary: ConfigSummary;
}

export function ConfigsClient() {
  const router = useRouter();
  const [configs, setConfigs] = useState<SavedConfig[] | null>(null);
  const [error, setError] = useState("");

  async function reload() {
    const response = await fetch("/api/configs");
    if (response.status === 401) {
      router.push("/login?next=/configs");
      return;
    }
    const data = (await response.json()) as { ok?: boolean; configs?: SavedConfig[] };
    setConfigs(data.configs ?? []);
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      void reload();
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount
  }, []);

  async function rename(id: string, current: string) {
    const name = window.prompt("新的名称", current);
    if (!name) return;
    const response = await fetch(`/api/configs/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!response.ok) {
      setError("改名失败");
      return;
    }
    await reload();
  }

  async function remove(id: string, name: string) {
    if (!window.confirm(`删除配置「${name}」？`)) return;
    const response = await fetch(`/api/configs/${id}`, { method: "DELETE" });
    if (!response.ok) {
      setError("删除失败");
      return;
    }
    await reload();
  }

  if (!configs) return <p className="text-sm text-slate-500">加载中…</p>;

  return (
    <section className="space-y-3">
      {error ? <p className="rounded-lg border border-rose-900 bg-rose-950/40 p-3 text-sm text-rose-200">{error}</p> : null}
      {configs.length === 0 ? (
        <p className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 text-sm text-slate-400">
          还没有保存的配置。到{" "}
          <Link className="text-emerald-400 underline" href="/build">
            构建页
          </Link>{" "}
          调好参数后点“保存到「我的配置」”。
        </p>
      ) : null}
      {configs.map((config) => (
        <article className="rounded-xl border border-slate-800 bg-slate-900/60 p-4" key={config.id}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-medium text-slate-100">{config.name}</h2>
            <span className="text-xs text-slate-500">
              更新于 {new Date(config.updatedAt).toLocaleString("zh-CN")}
            </span>
          </div>
          <p className="mt-1 font-mono text-xs text-slate-400">
            {config.summary.target} / {config.summary.profile} · {config.summary.release} ·{" "}
            {config.summary.variant || "—"} · hostname {config.summary.hostname || "—"} · {config.summary.packages} 个包
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <Link
              className="rounded-lg bg-emerald-500 px-3 py-1.5 font-medium text-emerald-950"
              href={`/build?config=${config.id}`}
            >
              套用这份配置
            </Link>
            <a
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-slate-300 hover:border-emerald-600"
              href={`/api/configs/${config.id}`}
            >
              导出 JSON
            </a>
            <button
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-slate-300 hover:border-emerald-600"
              onClick={() => void rename(config.id, config.name)}
              type="button"
            >
              改名
            </button>
            <button
              className="rounded-lg border border-rose-900 px-3 py-1.5 text-rose-300 hover:border-rose-700"
              onClick={() => void remove(config.id, config.name)}
              type="button"
            >
              删除
            </button>
            {config.sourceBuildId ? (
              <Link className="px-1 py-1.5 text-slate-500 underline" href={`/builds/${config.sourceBuildId}`}>
                来源构建 {config.sourceBuildId.slice(0, 8)}
              </Link>
            ) : null}
          </div>
        </article>
      ))}
    </section>
  );
}
