"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { BaseVersion, BaseVersionState } from "@/lib/base/types";

const PHASE_LABELS: Record<string, string> = {
  refreshing: "刷新目录中",
  building: "冒烟构建中",
  succeeded: "冒烟成功",
  failed: "冒烟失败",
};

interface FormState {
  version: string;
  releaseDate: string;
  imageBuilderUrl: string;
  imageBuilderSha256: string;
}

const EMPTY_FORM: FormState = {
  version: "",
  releaseDate: "",
  imageBuilderUrl: "",
  imageBuilderSha256: "",
};

function formatDate(value: string | null): string {
  if (!value) return "未知";
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : date.toISOString().slice(0, 10);
}

export function BaseVersionPanel({
  state,
  versions,
  repo,
}: {
  state: BaseVersionState;
  versions: BaseVersion[];
  repo: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [notice, setNotice] = useState<string | null>(null);

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
    const data = (await response.json().catch(() => ({}))) as { error?: string; errors?: string[] };
    if (!response.ok) {
      throw new Error(data.errors?.join("；") ?? data.error ?? `HTTP ${response.status}`);
    }
  }

  async function run(action: "check" | "revert") {
    setBusy(action);
    setError(null);
    try {
      if (action === "check") await post("/api/admin/base-version/check");
      if (action === "revert") await post("/api/admin/base-version", { action: "revert" });
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  async function triggerSupplement() {
    setBusy("supplement");
    setError(null);
    setNotice(null);
    try {
      await post("/api/admin/base-version/supplement");
      setNotice("已触发 supplement 包构建，稍后可在最近工作流运行中查看。");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  async function adopt(version: string) {
    setBusy(`bump:${version}`);
    setError(null);
    try {
      await post("/api/admin/base-version", { action: "bump", version });
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  function openCreate() {
    setEditing(false);
    setForm(EMPTY_FORM);
    setNotice(null);
    setFormOpen(true);
  }

  function openEdit(record: BaseVersion) {
    setEditing(true);
    setForm({
      version: record.version,
      releaseDate: record.releaseDate ?? "",
      imageBuilderUrl: record.imageBuilderUrl,
      imageBuilderSha256: record.imageBuilderSha256,
    });
    setNotice(null);
    setFormOpen(true);
  }

  async function fillFromRelease() {
    if (!form.version.trim()) {
      setError("请先填写版本号");
      return;
    }
    setBusy("discover");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/admin/base-version/discover?version=${encodeURIComponent(form.version.trim())}`,
      );
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        candidate?: { releaseDate: string | null; imageBuilderUrl: string; imageBuilderSha256: string };
      };
      if (!response.ok || !data.candidate) throw new Error(data.error ?? `HTTP ${response.status}`);
      setForm((current) => ({
        ...current,
        version: current.version.trim(),
        releaseDate: data.candidate?.releaseDate ?? current.releaseDate,
        imageBuilderUrl: data.candidate?.imageBuilderUrl ?? current.imageBuilderUrl,
        imageBuilderSha256: data.candidate?.imageBuilderSha256 ?? current.imageBuilderSha256,
      }));
      setNotice("已从 ImmortalWrt release 目录和 sha256sums 填充。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    setError(null);
    setNotice(null);
    try {
      await post("/api/admin/base-version", { action: "register", ...form });
      setFormOpen(false);
      setNotice("已保存；该版本不会自动切换，需手动“采用”。");
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
          <p className="mt-1 text-xs text-slate-500">采用新版本前先刷新目录并跑一次冒烟构建；手工登记不会自动切换。</p>
        </div>
        <div className="flex gap-2">
          <button
            className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 disabled:opacity-50"
            disabled={busy !== null}
            onClick={() => run("check")}
            type="button"
          >
            {busy === "check" ? "检查中…" : "检查新版本"}
          </button>
          <button
            className="rounded border border-emerald-800 px-3 py-1.5 text-xs text-emerald-300 disabled:opacity-50"
            disabled={busy !== null}
            onClick={openCreate}
            type="button"
          >
            登记版本
          </button>
          <button
            className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 disabled:opacity-50"
            disabled={busy !== null || !state.active}
            onClick={triggerSupplement}
            type="button"
          >
            {busy === "supplement" ? "触发中…" : "重建 supplement 包"}
          </button>
        </div>
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

      {formOpen && (
        <div className="mt-4 rounded-lg border border-emerald-900/60 bg-emerald-950/20 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-emerald-200">{editing ? `编辑 ${form.version}` : "登记基线版本"}</p>
            <button className="text-xs text-slate-400" onClick={() => setFormOpen(false)} type="button">
              取消
            </button>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-slate-400">
              版本号
              <input
                className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-sm text-slate-200"
                onChange={(event) => setForm({ ...form, version: event.target.value })}
                placeholder="25.12.3"
                value={form.version}
              />
            </label>
            <label className="text-xs text-slate-400">
              发布日期
              <input
                className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200"
                onChange={(event) => setForm({ ...form, releaseDate: event.target.value })}
                placeholder="2026-09-08"
                value={form.releaseDate}
              />
            </label>
            <label className="text-xs text-slate-400 sm:col-span-2">
              ImageBuilder URL
              <input
                className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-xs text-slate-200"
                onChange={(event) => setForm({ ...form, imageBuilderUrl: event.target.value })}
                value={form.imageBuilderUrl}
              />
            </label>
            <label className="text-xs text-slate-400 sm:col-span-2">
              ImageBuilder sha256
              <input
                className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-xs text-slate-200"
                onChange={(event) => setForm({ ...form, imageBuilderSha256: event.target.value })}
                value={form.imageBuilderSha256}
              />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 disabled:opacity-50"
              disabled={busy !== null}
              onClick={fillFromRelease}
              type="button"
            >
              {busy === "discover" ? "填充中…" : "从官方 release 自动填充"}
            </button>
            <button
              className="rounded bg-emerald-500 px-3 py-1.5 text-xs font-medium text-slate-950 disabled:opacity-50"
              disabled={busy !== null}
              onClick={save}
              type="button"
            >
              {busy === "save" ? "保存中…" : "保存记录"}
            </button>
          </div>
        </div>
      )}

      {notice && <p className="mt-3 text-xs text-emerald-300">{notice}</p>}

      {versions.length > 0 && (
        <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
          <p className="text-xs font-medium text-slate-400">已登记版本（候选，需手动采用）</p>
          <ul className="mt-2 divide-y divide-slate-800">
            {versions.map((record) => (
              <li className="flex flex-wrap items-center justify-between gap-2 py-2" key={record.version}>
                <div>
                  <span className="font-mono text-slate-200">{record.version}</span>
                  <span className="ml-2 text-xs text-slate-500">{formatDate(record.releaseDate)}</span>
                  {state.active?.version === record.version && (
                    <span className="ml-2 rounded bg-emerald-900/60 px-1.5 py-0.5 text-[10px] text-emerald-300">当前</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <button className="text-xs text-slate-400 underline" onClick={() => openEdit(record)} type="button">
                    编辑
                  </button>
                  {state.active?.version !== record.version && (
                    <button
                      className="text-xs text-amber-300 underline disabled:opacity-50"
                      disabled={busy !== null}
                      onClick={() => adopt(record.version)}
                      type="button"
                    >
                      {busy === `bump:${record.version}` ? "采用中…" : "采用"}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
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
            onClick={() => adopt(state.candidate!.version)}
            type="button"
          >
            {busy === `bump:${state.candidate.version}` ? "采用中…" : `采用 ${state.candidate.version}`}
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
          {state.supplementBuild.runId && repo && (
            <p className="mt-1 text-xs">
              <a
                className="text-emerald-300 underline decoration-emerald-800"
                href={`https://github.com/${repo}/actions/runs/${state.supplementBuild.runId}`}
              >
                查看 supplement 运行 {state.supplementBuild.runId}
              </a>
            </p>
          )}
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
