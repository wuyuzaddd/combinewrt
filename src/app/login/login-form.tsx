"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function LoginForm({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (response.ok) {
        router.push(nextPath);
        router.refresh();
        return;
      }

      if (response.status === 401) {
        setError("密码错误。");
      } else if (response.status === 429) {
        const data = (await response.json().catch(() => ({}))) as { retryAfterMs?: number };
        const minutes = Math.max(1, Math.ceil((data.retryAfterMs ?? 60_000) / 60_000));
        setError(`尝试次数过多，请约 ${minutes} 分钟后再试。`);
      } else {
        setError("登录失败，请查看服务端日志。");
      }
    } catch {
      setError("无法连接服务器。");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      <label className="flex flex-col gap-2 text-sm">
        <span className="text-slate-300">管理员密码</span>
        <input
          autoComplete="current-password"
          autoFocus
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 outline-none focus:border-emerald-500"
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
      </label>
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      <button
        className="rounded-lg bg-emerald-500 px-4 py-2 font-medium text-slate-950 disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "登录中…" : "登录"}
      </button>
    </form>
  );
}
