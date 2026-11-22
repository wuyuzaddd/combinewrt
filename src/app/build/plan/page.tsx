"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { BuildConflict, BuildPlan } from "@/lib/build/types";
import { PlanPreview } from "../plan-preview";
import type { BuildFormState } from "../form-model";

/** Matches the key `build-form.tsx` writes before navigating here. */
const PENDING_PLAN_KEY = "combinewrt.build.pending-plan.v1";

interface PendingPlan {
  form: BuildFormState;
  plan: BuildPlan;
  /** The submitted body with `rootPassword` stripped; the password is asked here. */
  body: Record<string, unknown>;
  savedAt: string;
}

export default function PlanPage() {
  const router = useRouter();
  const [pending, setPending] = useState<PendingPlan | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [password, setPassword] = useState("");
  const [dispatching, setDispatching] = useState(false);
  const [error, setError] = useState("");
  const [conflicts, setConflicts] = useState<BuildConflict[]>([]);

  useEffect(() => {
    // Deferred one tick: sessionStorage is not available during SSR, and the
    // lint rule forbids setting state synchronously from the effect body.
    const timer = setTimeout(() => {
      try {
        const raw = window.sessionStorage.getItem(PENDING_PLAN_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as PendingPlan;
          if (parsed?.plan && parsed?.form) {
            setPending(parsed);
            setConflicts(parsed.plan.conflicts ?? []);
          }
        }
      } catch {
        // fall through to the empty state
      }
      setLoaded(true);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  async function dispatch() {
    if (!pending) return;
    if (password.length < 8) {
      setError("请先填写 root 密码（至少 8 位），它会随这次构建写入镜像，不会保存在浏览器。");
      return;
    }
    setDispatching(true);
    setError("");
    try {
      const response = await fetch("/api/builds", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...pending.body, rootPassword: password }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        build?: { id: string };
        issues?: string[];
        conflicts?: BuildConflict[];
        error?: string;
      };
      if (response.status === 401) {
        router.push("/login?next=/build/plan");
        return;
      }
      if (!response.ok) {
        setConflicts(data.conflicts ?? []);
        setError((data.issues ?? []).join("；") || data.error || "构建派发失败");
        return;
      }
      try {
        window.sessionStorage.removeItem(PENDING_PLAN_KEY);
      } catch {
        // ignore
      }
      router.push(`/builds/${data.build!.id}`);
    } catch {
      setError("请求失败，请检查网络后重试。");
    } finally {
      setDispatching(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-6 py-12">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-400">build / plan</p>
          <h1 className="mt-2 text-2xl font-semibold">计划预览</h1>
          <p className="mt-1 text-xs text-slate-500">
            这一页是独立路由：刷新不会丢表单草稿；派发后会跳转到按构建 ID 生成的进度页。
          </p>
        </div>
        <Link className="text-sm text-emerald-400 underline" href="/build">
          返回修改配置
        </Link>
      </header>

      {loaded && !pending ? (
        <section className="rounded-xl border border-amber-900/60 bg-amber-950/30 p-5 text-sm text-amber-200">
          没有待确认的计划（可能已经派发或换了浏览器标签）。返回{" "}
          <Link className="underline" href="/build">
            构建页
          </Link>{" "}
          重新生成即可，之前的配置会从浏览器草稿恢复。
        </section>
      ) : null}

      {pending ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
          <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-300">
            <p className="text-xs uppercase tracking-wider text-slate-500">待确认</p>
            <p className="mt-2 font-mono text-base text-slate-100">{pending.plan.artifactName}</p>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-400">
              <div>目标：{pending.form.targetId}</div>
              <div>profile：{pending.form.profileId}</div>
              <div>
                变体：{pending.form.variant.boot} / {pending.form.variant.filesystem} / {pending.form.variant.artifact}
              </div>
              <div>包数：{pending.plan.packages?.length ?? pending.form.packages.length}</div>
              <div>主机名：{pending.form.hostname || "—"}</div>
              <div>基线：{pending.form.release}</div>
            </dl>
            <p className="mt-3 text-xs text-slate-500">
              生成于 {new Date(pending.savedAt).toLocaleString("zh-CN")}；计划本身不会自动变化，改配置请返回上一页。
            </p>
            <label className="mt-4 block text-sm text-slate-300">
              root 密码（派发必需，不落盘到浏览器）
              <input
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm"
                onChange={(event) => setPassword(event.target.value)}
                placeholder="8–128 字符"
                type="password"
                value={password}
              />
            </label>
            {error ? (
              <p className="mt-3 rounded-lg border border-rose-900 bg-rose-950/40 p-3 text-sm text-rose-200">{error}</p>
            ) : null}
            <button
              className="mt-4 w-full rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-emerald-950 disabled:opacity-50"
              disabled={dispatching}
              onClick={dispatch}
              type="button"
            >
              {dispatching ? "派发中…" : "开始构建"}
            </button>
          </section>
          <PlanPreview
            conflicts={conflicts}
            dispatching={dispatching}
            form={pending.form}
            mode={pending.form.mode}
            onDispatch={dispatch}
            plan={pending.plan}
          />
        </div>
      ) : null}
    </main>
  );
}
