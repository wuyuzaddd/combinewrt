import Link from "next/link";
import { createExtensionCatalog } from "@/lib/extension/catalog";
import { loadExtensionBundles } from "@/lib/extension/bundles";
import { i18nFallsBack, i18nLabel, i18nShortLabel } from "@/lib/extension/i18n";
import { loadExtensionThemes } from "@/lib/extension/themes";
import type { ExtensionBundle, ExtensionTheme } from "@/lib/extension/types";
import { loadSourceRegistry } from "@/lib/sources/registry";

function readParam(params: Record<string, string | string[] | undefined>, key: string): string {
  const value = params[key];
  return typeof value === "string" ? value : "";
}

function categoryLabel(category: ExtensionBundle["category"]): string {
  switch (category) {
    case "proxy":
      return "代理";
    case "nas":
      return "NAS";
    case "download":
      return "下载";
    case "monitor":
      return "监控";
    case "theme":
      return "主题";
    default:
      return "系统";
  }
}

function ThemeCard({ theme }: { theme: ExtensionTheme }) {
  return (
    <article className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60">
      {/* Preview is a site asset checked in under public/themes (ticket 12). */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img alt={`${theme.title} 预览`} className="h-32 w-full object-cover" src={theme.preview} />
      <div className="p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-medium">{theme.title}</h3>
          {theme.default ? (
            <span className="rounded-full border border-emerald-800 px-2 py-0.5 text-[11px] text-emerald-300">
              默认主题
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-xs text-slate-400">{theme.description}</p>
        <p className="mt-2 font-mono text-[11px] text-slate-500">{theme.package}</p>
        <p className="mt-1 text-xs text-slate-500">支持 LuCI：{theme.luciVersions.join(" · ")}</p>
      </div>
    </article>
  );
}

export default async function ExtensionCatalogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = readParam(params, "q");

  const registry = loadSourceRegistry();
  const themes = loadExtensionThemes({ registry });
  const bundles = loadExtensionBundles({ registry });
  const catalog = createExtensionCatalog({ registry, themes, bundles, query });
  const suffix = query ? `?q=${encodeURIComponent(query)}` : "";

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-400">extension</p>
          <h1 className="mt-2 text-2xl font-semibold">扩展包与一键套餐</h1>
          <p className="mt-1 text-sm text-slate-400">
            扩展包从固定上游 commit 构建并签名后进入扩展 feed；主题通过普通软件包链路进入构建计划，不是独立安装器。
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Link className="text-sm text-slate-300 underline decoration-slate-600" href="/catalog">
            返回目录
          </Link>
        </div>
      </header>

      <section className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-slate-800 bg-slate-900/60 px-5 py-4 text-sm text-slate-400">
        <span>
          扩展包 <span className="text-slate-200">{catalog.counts.packages}</span> 个（公开{" "}
          {catalog.counts.publicPackages}）
        </span>
        <span>
          一键套餐 <span className="text-slate-200">{catalog.counts.bundles}</span> 个
        </span>
        <span>
          主题 <span className="text-slate-200">{catalog.counts.themes}</span> 个
        </span>
        <span className="text-xs">
          许可证标记来自 SPDX 元数据；experimental 包会单独标注。i18n 状态只是文案元数据，不改变来源、许可证或 ABI 校验。
        </span>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-lg font-medium">主题</h2>
          <form action="/catalog/extension" className="flex items-center gap-2" method="get">
            <input
              className="w-64 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm"
              defaultValue={query}
              name="q"
              placeholder="搜索扩展包、套餐或主题"
            />
            <button className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm" type="submit">
              搜索
            </button>
          </form>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {catalog.themes.length > 0 ? (
            catalog.themes.map((theme) => <ThemeCard key={theme.package} theme={theme} />)
          ) : (
            <p className="text-sm text-slate-500">还没有登记扩展主题。</p>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">一键套餐</h2>
        <p className="text-xs text-slate-500">
          套餐只引用来源登记表里的软件包，不含脚本或安装钩子；依赖测试在扩展构建工作流中执行，失败信息会点名套餐、软件包与目标。
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {catalog.bundles.length > 0 ? (
            catalog.bundles.map((bundle) => (
              <article className="rounded-xl border border-slate-800 bg-slate-900/60 p-4" key={bundle.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-medium">{bundle.title}</h3>
                  <div className="flex items-center gap-2 text-[11px] text-slate-400">
                    <span className="rounded-full border border-slate-700 px-2 py-0.5">
                      {categoryLabel(bundle.category)}
                    </span>
                    <span className="font-mono">{bundle.id}</span>
                  </div>
                </div>
                <p className="mt-1 text-xs text-slate-400">{bundle.description}</p>
                <p className="mt-2 flex flex-wrap gap-1">
                  {bundle.packages.map((name) => {
                    const item = catalog.packages.find((candidate) => candidate.name === name);
                    return (
                      <span
                        className="rounded border border-slate-700 px-1.5 py-0.5 font-mono text-[11px] text-slate-300"
                        key={name}
                      >
                        {name}
                        {item && i18nFallsBack({ i18nStatus: item.i18nStatus }) ? (
                          <span className="ml-1 text-amber-300">{i18nShortLabel({ i18nStatus: item.i18nStatus })}</span>
                        ) : null}
                      </span>
                    );
                  })}
                </p>
                <p className="mt-2 text-[11px] text-slate-500">
                  目标：{bundle.targets.join(" · ")} · SPDX：{bundle.license} ·{" "}
                  {bundle.publicAllowed ? "可进入公开镜像" : "仅私有镜像"}
                </p>
              </article>
            ))
          ) : (
            <p className="text-sm text-slate-500">没有匹配的套餐。</p>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">扩展包</h2>
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="min-w-full divide-y divide-slate-800 text-sm">
            <thead className="bg-slate-900/80 text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-2">名称</th>
                <th className="px-4 py-2">上游 commit</th>
                <th className="px-4 py-2">license</th>
                <th className="px-4 py-2">i18n</th>
                <th className="px-4 py-2">公开</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {catalog.packages.length > 0 ? (
                catalog.packages.map((item) => (
                  <tr className="hover:bg-slate-900/40" key={item.name}>
                    <td className="px-4 py-2">
                      <span className="font-mono text-xs text-slate-200">{item.name}</span>
                      {item.experimental ? (
                        <span className="ml-2 rounded border border-amber-800 px-1.5 py-0.5 text-[11px] text-amber-300">
                          experimental
                        </span>
                      ) : null}
                      {item.title !== item.name ? (
                        <p className="mt-0.5 text-xs text-slate-300">{item.title}</p>
                      ) : null}
                      <p className="mt-1 text-[11px] text-slate-500">{item.description}</p>
                    </td>
                    <td className="px-4 py-2 font-mono text-[11px] text-slate-400">
                      {item.repo ? `${item.repo}@${(item.ref ?? "").slice(0, 12)}` : "—"}
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-300">{item.license ?? "未登记"}</td>
                    <td className="px-4 py-2 text-xs text-slate-400">
                      {i18nLabel({ i18nStatus: item.i18nStatus })}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {item.publicAllowed ? (
                        <span className="text-emerald-300">公开</span>
                      ) : (
                        <span className="text-amber-300">仅私有</span>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-4 py-3 text-sm text-slate-500" colSpan={5}>
                    {query ? `没有匹配 “${query}” 的扩展包。` : "来源登记表里还没有扩展包。"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500">
          <Link className="underline decoration-slate-600" href={`/catalog${suffix}`}>
            查看完整软件包目录
          </Link>
        </p>
      </section>
    </main>
  );
}
