import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/current-session";
import { ConfigsClient } from "./configs-client";

export default async function ConfigsPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/configs");

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-6 py-12">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-400">configs</p>
          <h1 className="mt-2 text-2xl font-semibold">我的配置</h1>
          <p className="mt-1 text-xs text-slate-500">
            保存过的构建配置（不含 root 密码）。套用会回到构建页并预填全部字段。
          </p>
        </div>
        <Link className="text-sm text-emerald-400 underline" href="/build">
          去构建
        </Link>
      </header>
      <ConfigsClient />
    </main>
  );
}
