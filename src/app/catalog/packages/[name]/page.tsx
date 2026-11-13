import Link from "next/link";
import { notFound } from "next/navigation";
import { getDatabase } from "@/lib/db";
import { formatSize } from "@/lib/catalog/format";
import { createCatalogStore } from "@/lib/catalog/store";

export default async function PackageDetailPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const store = createCatalogStore(getDatabase());
  const snapshot = store.getActiveSnapshot();
  if (!snapshot) notFound();

  const pkg = store.getPackage(snapshot.id, name);
  if (!pkg) notFound();
  const candidates = store.getPackageCandidates(snapshot.id, name);

  const dependencies = pkg.depends.map((dependency) => ({
    name: dependency,
    exists: store.getPackage(snapshot.id, dependency) !== null,
  }));

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-12">
      <header>
        <Link className="text-sm text-slate-400 underline decoration-slate-700" href="/catalog">
          ← 返回目录
        </Link>
        <h1 className="mt-3 text-2xl font-semibold">{pkg.name}</h1>
        <p className="mt-1 text-sm text-slate-400">
          {pkg.version || "—"} · {pkg.arch || "—"} · feed {pkg.feed} ·{" "}
          <span className="rounded-full border border-emerald-800 px-2 py-0.5 text-xs text-emerald-300">
            {pkg.source}
          </span>
        </p>
      </header>

      {pkg.proprietary && (
        <section className="rounded-xl border border-amber-900 bg-amber-950/30 p-4 text-sm text-amber-200">
          <p className="font-medium">{pkg.license ? "专有（proprietary）软件包" : "未声明许可证"}</p>
          <p className="mt-1 text-xs">
            该包默认不允许进入公开镜像；自用构建可以安装，但 source offer 会把它列为受限包。
          </p>
        </section>
      )}

      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 text-sm">
        <p className="whitespace-pre-line text-slate-300">{pkg.description || "无描述。"}</p>
      </section>

      <dl className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <dt className="text-xs uppercase tracking-wider text-slate-500">安装大小</dt>
          <dd className="mt-1">{formatSize(pkg.installedSize)}</dd>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <dt className="text-xs uppercase tracking-wider text-slate-500">license</dt>
          <dd className={`mt-1 ${pkg.proprietary ? "text-amber-300" : ""}`}>
            {pkg.license || "未声明（按专有/无许可处理）"}
          </dd>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 sm:col-span-2">
          <dt className="text-xs uppercase tracking-wider text-slate-500">来源 pin</dt>
          <dd className="mt-1 break-all font-mono text-xs text-slate-400">{pkg.sourcePin || "—"}</dd>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 sm:col-span-2">
          <dt className="text-xs uppercase tracking-wider text-slate-500">包哈希（apk package hash）</dt>
          <dd className="mt-1 break-all font-mono text-xs text-slate-400">{pkg.sha256 || "—"}</dd>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <dt className="text-xs uppercase tracking-wider text-slate-500">文件</dt>
          <dd className="mt-1 break-all font-mono text-xs text-slate-400">
            {pkg.filename ?? "—"}（{formatSize(pkg.fileSize)}）
          </dd>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <dt className="text-xs uppercase tracking-wider text-slate-500">kmod</dt>
          <dd className="mt-1 text-sm">{pkg.kmod ? "是（仅允许官方来源）" : "否"}</dd>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 sm:col-span-2">
          <dt className="text-xs uppercase tracking-wider text-slate-500">origin</dt>
          <dd className="mt-1 font-mono text-xs text-slate-400">{pkg.origin || "—"}</dd>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 sm:col-span-2">
          <dt className="text-xs uppercase tracking-wider text-slate-500">下载地址</dt>
          <dd className="mt-1 break-all font-mono text-xs text-slate-400">{pkg.downloadUrl || "—"}</dd>
        </div>
      </dl>

      {candidates.length > 1 ? (
        <section>
          <h2 className="text-lg font-medium">同名包的其他来源（{candidates.length - 1}）</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {candidates
              .filter((candidate) => candidate.source !== pkg.source)
              .map((candidate) => (
                <li className="rounded-lg border border-slate-800 bg-slate-900/60 p-3" key={candidate.source}>
                  <span className="rounded-full border border-slate-700 px-2 py-0.5 text-xs">{candidate.source}</span>
                  <span className="ml-2 font-mono text-xs text-slate-400">
                    {candidate.version} · {candidate.filename ?? "—"}
                  </span>
                </li>
              ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h2 className="text-lg font-medium">直接依赖（{dependencies.length}）</h2>
        {dependencies.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-2">
            {dependencies.map((dependency) => (
              <li key={dependency.name}>
                {dependency.exists ? (
                  <Link
                    className="rounded-full border border-slate-700 px-3 py-1 text-xs text-emerald-300"
                    href={`/catalog/packages/${encodeURIComponent(dependency.name)}`}
                  >
                    {dependency.name}
                  </Link>
                ) : (
                  <span className="rounded-full border border-slate-800 px-3 py-1 text-xs text-slate-500">
                    {dependency.name}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-slate-500">无直接依赖。</p>
        )}
      </section>
    </main>
  );
}
