import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/current-session";
import { LogoutButton } from "./logout-button";

const sections = [
  { title: "固件构建", body: "选择设备、镜像格式、软件包并预览构建计划。", href: "/build" },
  { title: "构建历史", body: "查看排队、运行、成功/失败记录并下载产物。", href: "/builds" },
  { title: "软件包目录", body: "浏览 ImmortalWrt 官方 feed 的目录快照。", href: "/catalog" },
  { title: "基础版本", body: "ImmortalWrt 版本与冒烟状态（后续版本）。", href: null },
];

export default async function AdminPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/admin");

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-8 px-6 py-12">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-400">admin</p>
          <h1 className="mt-2 text-2xl font-semibold">管理台</h1>
          <p className="mt-1 text-sm text-slate-400">已登录 · 会话有效期 7 天</p>
        </div>
        <LogoutButton />
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        {sections.map((section) => (
          <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5" key={section.title}>
            <h2 className="font-medium">
              {section.href ? (
                <Link className="text-emerald-300 underline decoration-emerald-800" href={section.href}>
                  {section.title}
                </Link>
              ) : (
                section.title
              )}
            </h2>
            <p className="mt-1 text-sm text-slate-400">{section.body}</p>
          </section>
        ))}
      </div>

      <p className="text-xs text-slate-500">
        设备目录与构建表单已接入（ticket 02/03）。队列与产物下载在后续票据接入。
      </p>
    </main>
  );
}
