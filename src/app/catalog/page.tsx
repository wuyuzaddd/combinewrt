import Link from "next/link";
import { getSession } from "@/lib/auth/current-session";
import { getDatabase } from "@/lib/db";
import { formatSize } from "@/lib/catalog/format";
import { imageFormatLabel } from "@/lib/catalog/profiles";
import { createCatalogStore } from "@/lib/catalog/store";
import { RefreshButton } from "./refresh-button";

const PAGE_SIZE = 40;

function readParam(params: Record<string, string | string[] | undefined>, key: string): string {
  const value = params[key];
  return typeof value === "string" ? value : "";
}

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = readParam(params, "q");
  const category = readParam(params, "category");
  const pageNumber = Math.max(1, Number.parseInt(readParam(params, "page") || "1", 10) || 1);

  const store = createCatalogStore(getDatabase());
  const snapshot = store.getActiveSnapshot();
  const session = await getSession();

  const profiles = snapshot ? store.listProfiles(snapshot.id) : [];
  const categories = snapshot ? store.listCategories(snapshot.id) : [];
  const sourceCounts = snapshot ? store.sourceCounts(snapshot.id) : { official: 0, dllkids: 0, supplement: 0 };
  const pins = snapshot?.sourcePins;
  const result = snapshot
    ? store.searchPackages(snapshot.id, {
        query,
        category,
        limit: PAGE_SIZE,
        offset: (pageNumber - 1) * PAGE_SIZE,
      })
    : { items: [], total: 0 };
  const pageCount = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const pageLink = (page: number) => {
    const search = new URLSearchParams();
    if (query) search.set("q", query);
    if (category) search.set("category", category);
    search.set("page", String(page));
    return `/catalog?${search.toString()}`;
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-400">catalog</p>
          <h1 className="mt-2 text-2xl font-semibold">设备与软件包目录</h1>
          <p className="mt-1 text-sm text-slate-400">ImmortalWrt 官方 x86_64 feed 与 dllkids 组合来源的只读快照。</p>
        </div>
        <div className="flex items-center gap-4">
          <Link className="text-sm text-slate-300 underline decoration-slate-600" href="/">
            返回首页
          </Link>
          {session ? <RefreshButton /> : null}
        </div>
      </header>

      {!snapshot ? (
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
          <h2 className="font-medium">尚未生成目录快照</h2>
          <p className="mt-2 text-sm text-slate-400">
            {session
              ? "点击右上角“刷新目录”，从 ImmortalWrt 官方 feed 拉取 profiles 与软件包索引。"
              : "管理员登录后可刷新目录。"}
          </p>
        </section>
      ) : (
        <>
          <section className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-slate-800 bg-slate-900/60 px-5 py-4 text-sm text-slate-400">
            <span>
              基线 <span className="text-slate-200">{snapshot.baseVersion}</span>
            </span>
            <span>
              feed commit <code className="text-slate-200">{snapshot.feedCommit}</code>
            </span>
            <span>
              {snapshot.profileCount} 个设备 · {snapshot.packageCount} 个软件包（官方 {sourceCounts.official} · dllkids{" "}
              {sourceCounts.dllkids} · 自有 {sourceCounts.supplement}）
            </span>
            <span className="text-xs">生成于 {snapshot.createdAt} UTC</span>
            <span className="w-full break-all text-xs text-slate-500">来源：{snapshot.sourceNote}</span>
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 text-sm">
            <h2 className="font-medium">来源 pin</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-wider text-slate-500">官方 feed commits</p>
                <ul className="mt-1 space-y-1 font-mono text-xs text-slate-300">
                  {Object.entries(pins?.official ?? {}).map(([feed, pin]) => (
                    <li key={feed}>
                      {feed}: {pin}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="space-y-2 break-all font-mono text-xs text-slate-300">
                <p>
                  <span className="text-slate-500">dllkids index sha256：</span>
                  {pins?.dllkids ?? "未配置"}
                </p>
                <p>
                  <span className="text-slate-500">自有源 commit：</span>
                  {pins?.supplement?.commit ?? "未配置"}
                </p>
                <p>
                  <span className="text-slate-500">自有源签名：</span>
                  {pins?.supplement?.fingerprint ?? "未配置"}
                </p>
                <p>
                  <span className="text-slate-500">kernel：</span>
                  {pins?.kernel
                    ? `${pins.kernel.version}-${pins.kernel.release}-${pins.kernel.vermagic}`
                    : "未记录"}
                </p>
              </div>
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-medium">设备（x86_64）</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {profiles.map((profile) => (
                <article className="rounded-xl border border-slate-800 bg-slate-900/60 p-4" key={profile.id}>
                  <h3 className="font-medium">{profile.title}</h3>
                  <p className="mt-1 font-mono text-xs text-slate-500">{profile.id}</p>
                  <p className="mt-2 text-xs text-slate-400">
                    镜像格式：
                    {profile.formats.length > 0
                      ? profile.formats.map(imageFormatLabel).join(" · ")
                      : `无构建支持格式（该 profile 共 ${profile.imageCount} 个镜像）`}
                  </p>
                </article>
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h2 className="text-lg font-medium">软件包</h2>
              <form action="/catalog" className="flex flex-wrap items-center gap-2" method="get">
                <input
                  className="w-64 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm"
                  defaultValue={query}
                  name="q"
                  placeholder="按名称或描述搜索"
                />
                <select
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm"
                  defaultValue={category}
                  name="category"
                >
                  <option value="">全部分类</option>
                  {categories.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
                <button className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm" type="submit">
                  筛选
                </button>
              </form>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-800">
              <table className="min-w-full divide-y divide-slate-800 text-sm">
                <thead className="bg-slate-900/80 text-left text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-2">名称</th>
                    <th className="px-4 py-2">版本</th>
                    <th className="px-4 py-2">安装大小</th>
                    <th className="px-4 py-2">分类</th>
                    <th className="px-4 py-2">license</th>
                    <th className="px-4 py-2">来源</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {result.items.map((pkg) => (
                    <tr className="hover:bg-slate-900/40" key={pkg.name}>
                      <td className="px-4 py-2">
                        <Link
                          className="text-emerald-300 underline decoration-emerald-800"
                          href={`/catalog/packages/${encodeURIComponent(pkg.name)}`}
                        >
                          {pkg.name}
                        </Link>
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-slate-400">{pkg.version || "—"}</td>
                      <td className="px-4 py-2 text-slate-400">{formatSize(pkg.installedSize)}</td>
                      <td className="px-4 py-2 text-slate-400">{pkg.category}</td>
                      <td className="px-4 py-2 text-slate-400">
                        {pkg.proprietary ? <span className="text-amber-300">需注意</span> : pkg.license}
                      </td>
                      <td className="px-4 py-2 text-slate-500">
                        <span className="rounded-full border border-slate-700 px-2 py-0.5 text-xs">{pkg.source}</span>
                        <span className="ml-2 text-xs">{pkg.feed}</span>
                      </td>
                    </tr>
                  ))}
                  {result.items.length === 0 ? (
                    <tr>
                      <td className="px-4 py-6 text-center text-slate-500" colSpan={6}>
                        没有匹配的软件包。
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between text-sm text-slate-400">
              <span>
                共 {result.total} 个 · 第 {Math.min(pageNumber, pageCount)}/{pageCount} 页
              </span>
              <div className="flex gap-2">
                {pageNumber > 1 ? (
                  <Link className="rounded-lg border border-slate-700 px-3 py-1" href={pageLink(pageNumber - 1)}>
                    上一页
                  </Link>
                ) : null}
                {pageNumber < pageCount ? (
                  <Link className="rounded-lg border border-slate-700 px-3 py-1" href={pageLink(pageNumber + 1)}>
                    下一页
                  </Link>
                ) : null}
              </div>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
