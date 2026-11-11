import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/current-session";
import { safeNextPath } from "@/lib/auth/next-path";
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const session = await getSession();
  if (session) redirect("/admin");

  const { next } = await searchParams;
  const nextPath = safeNextPath(next);

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-emerald-400">combinewrt</p>
        <h1 className="mt-2 text-2xl font-semibold">管理员登录</h1>
        <p className="mt-2 text-sm text-slate-400">使用部署时配置的管理员密码。</p>
      </div>
      <LoginForm nextPath={nextPath} />
    </main>
  );
}
