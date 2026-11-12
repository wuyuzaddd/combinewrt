import Link from "next/link";
import { getSession } from "@/lib/auth/current-session";

export default async function HomePage() {
  const session = await getSession();

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-8 px-6 py-16">
      <header>
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-emerald-400">combinewrt</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">自用 OpenWrt 固件构建站</h1>
        <p className="mt-4 text-slate-400">公开页面为只读目录。固件构建、下载与管理操作需要管理员登录。</p>
      </header>

      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
        <h2 className="text-lg font-medium">当前状态</h2>
        <p className="mt-2 text-sm text-slate-400">
          站点骨架已就绪。设备目录、软件包浏览与构建表单将在后续版本开放。
        </p>
      </section>

      <nav className="flex flex-wrap gap-3 text-sm">
        <a
          className="rounded-lg border border-emerald-500/60 px-4 py-2 font-medium text-emerald-300"
          href="https://wuyuzaddd.github.io/combinewrt-packages/"
          rel="noreferrer"
        >
          软件包
        </a>
        {session ? (
          <Link className="rounded-lg bg-emerald-500 px-4 py-2 font-medium text-slate-950" href="/admin">
            进入管理台
          </Link>
        ) : (
          <Link className="rounded-lg bg-emerald-500 px-4 py-2 font-medium text-slate-950" href="/login">
            管理员登录
          </Link>
        )}
      </nav>

      <footer className="text-xs leading-relaxed text-slate-500">
        OpenWrt® is a registered trademark of Software Freedom Conservancy. combinewrt is an independent
        project and is not affiliated with, endorsed by, or sponsored by the OpenWrt project or SFC.
      </footer>
    </main>
  );
}
