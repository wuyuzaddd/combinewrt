import Link from "next/link";
import { notFound } from "next/navigation";
import { getBuildService } from "@/lib/builds";
import { ComplianceIssueList } from "@/components/compliance";
import { loadSourceOffer } from "@/lib/source-offer/load";
import { distributionLabel } from "@/lib/source-offer/manifest";
import { CopyLinkButton } from "./copy-link";

export default async function SourceOfferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Public GPL offer: read the stored build only, so an unauthenticated view
  // never triggers a GitHub API call.
  const build = getBuildService().get(id);
  if (!build) notFound();

  const offer = loadSourceOffer(build);
  const pins = offer.sourcePins;

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-6 py-12">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-400">source offer</p>
          <h1 className="mt-2 text-2xl font-semibold">源码与来源清单</h1>
          <p className="mt-1 break-all font-mono text-xs text-slate-500">
            {offer.build.artifactName} · build {offer.build.id}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {offer.build.profileTitle} · {offer.build.imageType} · {offer.build.status} ·{" "}
            {new Date(offer.build.createdAt).toLocaleString("zh-CN")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <CopyLinkButton />
          <a
            className="rounded-lg border border-emerald-800 px-3 py-1.5 text-xs text-emerald-300"
            href={`/api/builds/${build.id}/source-offer`}
          >
            下载 JSON
          </a>
          <Link className="text-slate-400" href={`/builds/${build.id}`}>
            返回构建
          </Link>
        </div>
      </header>

      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 text-sm">
        <h2 className="font-medium">GPL source offer</h2>
        <p className="mt-2 text-slate-400">
          本页记录该镜像使用的 ImmortalWrt 基线、官方 feed 提交、dllkids 索引校验值、自有 supplement
          源与构建配置，供分发镜像时履行源码提供义务。页面链接可复制，JSON 版本可归档。
        </p>
        <p
          className={`mt-3 inline-block rounded-full px-3 py-1 text-xs ${
            offer.publicDistribution
              ? "bg-emerald-950/60 text-emerald-200"
              : "bg-amber-950/60 text-amber-200"
          }`}
        >
          {distributionLabel(offer.visibility, offer.compliance.publicEligible)}
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <p className="text-xs uppercase tracking-wider text-slate-500">OpenWrt tag</p>
            <p className="mt-1 font-mono text-slate-200">{offer.openwrtTag}</p>
            <p className="mt-1 text-xs text-slate-500">ImmortalWrt 基线 {offer.baseVersion}</p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <p className="text-xs uppercase tracking-wider text-slate-500">ImageBuilder</p>
            <p className="mt-1 break-all font-mono text-xs text-slate-300">
              {offer.imageBuilder?.url ?? "基线记录中未找到 ImageBuilder 地址"}
            </p>
            <p className="mt-1 break-all font-mono text-xs text-slate-500">{offer.imageBuilder?.sha256 ?? "—"}</p>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 text-sm">
        <h2 className="font-medium">来源 pin</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-wider text-slate-500">官方 feed commits</p>
            <ul className="mt-2 space-y-1 font-mono text-xs text-slate-300">
              {Object.entries(pins.official).length > 0 ? (
                Object.entries(pins.official).map(([feed, pin]) => (
                  <li className="break-all" key={feed}>
                    <span className="text-slate-500">{feed}: </span>
                    {pin}
                  </li>
                ))
              ) : (
                <li className="text-slate-500">未记录</li>
              )}
            </ul>
          </div>
          <div className="space-y-2 break-all font-mono text-xs text-slate-300">
            <p>
              <span className="text-slate-500">dllkids packages.adb sha256：</span>
              {pins.dllkids ?? "未使用"}
            </p>
            <p>
              <span className="text-slate-500">supplement commit：</span>
              {pins.supplement?.commit ?? "未配置"}
            </p>
            <p>
              <span className="text-slate-500">supplement 签名指纹：</span>
              {pins.supplement?.fingerprint ?? "未配置"}
            </p>
            <p>
              <span className="text-slate-500">supplement index sha256：</span>
              {pins.supplement?.indexSha256 ?? "未记录"}
            </p>
            <p>
              <span className="text-slate-500">kernel：</span>
              {pins.kernel ? `${pins.kernel.version}-${pins.kernel.release}-${pins.kernel.vermagic}` : "未记录"}
            </p>
          </div>
        </div>
      </section>

      {offer.v2 && (
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 text-sm">
          <h2 className="font-medium">V2 构建组合</h2>
          <p className="mt-1 text-xs text-slate-500">
            记录引擎、目标与内核线、镜像变体、模式栈与每个包的获取策略；V1 source offer 不显示此段。
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
              <p className="text-xs uppercase tracking-wider text-slate-500">引擎</p>
              <p className="mt-1 font-mono text-slate-200">{offer.v2.engine}</p>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
              <p className="text-xs uppercase tracking-wider text-slate-500">通道</p>
              <p className="mt-1 font-mono text-slate-200">{offer.v2.channel}</p>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
              <p className="text-xs uppercase tracking-wider text-slate-500">目标 / Profile</p>
              <p className="mt-1 font-mono text-slate-200">
                {offer.v2.target.id} · {offer.v2.deviceProfile.id}
              </p>
              <p className="mt-1 text-xs text-slate-500">{offer.v2.deviceProfile.title}</p>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
              <p className="text-xs uppercase tracking-wider text-slate-500">内核线</p>
              <p className="mt-1 font-mono text-slate-200">
                {offer.v2.kernelLine.id} · {offer.v2.kernelLine.engine}
              </p>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
              <p className="text-xs uppercase tracking-wider text-slate-500">镜像变体</p>
              <p className="mt-1 font-mono text-slate-200">
                {offer.v2.imageVariant.boot} / {offer.v2.imageVariant.filesystem} /{" "}
                {offer.v2.imageVariant.artifact}
                {offer.v2.imageVariant.overlaySizeMb ? ` · overlay ${offer.v2.imageVariant.overlaySizeMb} MB` : ""}
              </p>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
              <p className="text-xs uppercase tracking-wider text-slate-500">基础 preset</p>
              <p className="mt-1 text-slate-200">
                {offer.v2.basePreset.title}（{offer.v2.basePreset.id}）
              </p>
            </div>
          </div>

          <div className="mt-4">
            <p className="text-xs uppercase tracking-wider text-slate-500">模式栈</p>
            {offer.v2.overlays.length === 0 ? (
              <p className="mt-1 text-xs text-slate-500">没有 overlay 模式。</p>
            ) : (
              <ul className="mt-1 flex flex-wrap gap-2">
                {offer.v2.overlays.map((mode) => (
                  <li
                    className={`rounded-full border px-3 py-1 text-xs ${
                      mode.experimental
                        ? "border-amber-800 text-amber-200"
                        : "border-slate-700 text-slate-300"
                    }`}
                    key={mode.id}
                  >
                    {mode.title}（{mode.id}）{mode.experimental ? " · 实验" : ""}
                  </li>
                ))}
              </ul>
            )}
            {offer.v2.imageVariant && offer.modes && (
              <p className="mt-2 text-xs text-slate-500">
                生成文件：{offer.modes.generatedFiles.join(", ") || "（无）"}
              </p>
            )}
          </div>

          <div className="mt-4">
            <p className="text-xs uppercase tracking-wider text-slate-500">获取策略（strategy / fallback）</p>
            <div className="mt-2 max-h-72 overflow-auto">
              <table className="min-w-full divide-y divide-slate-800 text-xs">
                <thead className="sticky top-0 bg-slate-900 text-left uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-2 py-2">包</th>
                    <th className="px-2 py-2">来源</th>
                    <th className="px-2 py-2">请求策略</th>
                    <th className="px-2 py-2">实际策略</th>
                    <th className="px-2 py-2">回退原因</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {offer.v2.strategies.map((strategy) => (
                    <tr key={strategy.name}>
                      <td className="px-2 py-1.5 font-mono text-slate-200">{strategy.name}</td>
                      <td className="px-2 py-1.5 text-slate-400">{strategy.source ?? "unknown"}</td>
                      <td className="px-2 py-1.5 font-mono text-slate-400">{strategy.requested}</td>
                      <td
                        className={`px-2 py-1.5 font-mono ${
                          strategy.effective === "blocked" ? "text-rose-300" : "text-emerald-300"
                        }`}
                      >
                        {strategy.effective}
                      </td>
                      <td className="px-2 py-1.5 text-slate-400">{strategy.fallbackReason ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-4">
            <p className="text-xs uppercase tracking-wider text-slate-500">镜像 feed set</p>
            {offer.feedSet ? (
              <div className="mt-1 space-y-1 text-xs text-slate-400">
                <p>
                  可见性 {offer.feedSet.visibility} · 官方源 {offer.feedSet.officialBaseUrl}
                  {offer.feedSet.officialMirror ? ` · 镜像 ${offer.feedSet.officialMirror}` : ""}
                </p>
                <p>
                  签名 key：{offer.feedSet.key.path} · 指纹 {offer.feedSet.key.fingerprint}
                </p>
                <ul className="space-y-1">
                  {offer.feedSet.repositories.map((repository) => (
                    <li className="break-all font-mono" key={repository.id}>
                      {repository.id} · {repository.signed ? "signed" : "unsigned"} · {repository.condition} ·{" "}
                      {repository.url}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="mt-1 text-xs text-slate-500">该计划没有记录 feed set（早于 ticket 09 的计划）。</p>
            )}
          </div>
        </section>
      )}

      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 text-sm">
        <h2 className="font-medium">构建配置</h2>
        {offer.config ? (
          <dl className="mt-3 grid gap-x-6 gap-y-1 text-slate-300 sm:grid-cols-2">
            <div><dt className="inline text-slate-500">profile：</dt><dd className="inline font-mono">{offer.build.profileId}</dd></div>
            <div><dt className="inline text-slate-500">镜像：</dt><dd className="inline font-mono">{offer.build.imageType}</dd></div>
            <div><dt className="inline text-slate-500">hostname：</dt><dd className="inline font-mono">{offer.config.hostname}</dd></div>
            <div><dt className="inline text-slate-500">时区：</dt><dd className="inline font-mono">{offer.config.timezone}</dd></div>
            <div><dt className="inline text-slate-500">LAN：</dt><dd className="inline font-mono">{offer.config.lanIp} / {offer.config.netmask}</dd></div>
            <div><dt className="inline text-slate-500">产物：</dt><dd className="inline font-mono">{offer.build.artifactName}</dd></div>
            <div className="sm:col-span-2">
              <dt className="inline text-slate-500">软件包：</dt>
              <dd className="inline break-all font-mono text-xs">{offer.config.packages.join(", ") || "（空）"}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="inline text-slate-500">生成文件：</dt>
              <dd className="inline break-all font-mono text-xs">{offer.generatedFiles.join(", ") || "（无）"}</dd>
            </div>
          </dl>
        ) : (
          <p className="mt-2 text-xs text-slate-500">旧构建没有保存表单配置。</p>
        )}
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 text-sm">
        <h2 className="font-medium">Patch 列表（{offer.patches.length}）</h2>
        {offer.patches.length > 0 ? (
          <ul className="mt-2 space-y-1 text-slate-300">
            {offer.patches.map((patch) => (
              <li className="break-all font-mono text-xs" key={patch.name}>
                {patch.name} · {patch.license} · {patch.source}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-slate-500">
            本构建未应用额外 patch；如后续引入 OpenWrt 派生 patch，将放在仓库 <code>patches/</code> 目录并按
            GPL-2.0-only 单独标注。
          </p>
        )}
      </section>

      <section
        className={`rounded-xl border p-5 text-sm ${
          offer.compliance.publicEligible
            ? "border-emerald-900 bg-emerald-950/20 text-emerald-200"
            : "border-amber-900 bg-amber-950/30 text-amber-200"
        }`}
      >
        <h2 className="font-medium">
          {offer.compliance.publicEligible ? "许可证检查通过（可公开分发）" : "仅限自用，不进入公开镜像"}
        </h2>
        {offer.compliance.issues.length === 0 ? (
          <p className="mt-2 text-xs">全部软件包都声明了非专有许可证。</p>
        ) : (
          <ComplianceIssueList issues={offer.compliance.issues} className="mt-2 space-y-1 text-xs" />
        )}
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 text-sm">
        <h2 className="font-medium">软件包来源（{offer.packages.length}）</h2>
        <div className="mt-3 max-h-96 overflow-auto">
          <table className="min-w-full divide-y divide-slate-800 text-xs">
            <thead className="sticky top-0 bg-slate-900 text-left uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-2 py-2">名称</th>
                <th className="px-2 py-2">版本</th>
                <th className="px-2 py-2">来源</th>
                <th className="px-2 py-2">source pin</th>
                <th className="px-2 py-2">license</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {offer.packages.map((pkg) => (
                <tr key={pkg.name}>
                  <td className="px-2 py-1.5 font-mono text-slate-200">{pkg.name}</td>
                  <td className="px-2 py-1.5 font-mono text-slate-400">{pkg.version ?? "—"}</td>
                  <td className="px-2 py-1.5 text-slate-400">{pkg.source ?? "—"}</td>
                  <td className="px-2 py-1.5 break-all font-mono text-slate-500">{pkg.sourcePin ?? "—"}</td>
                  <td className={`px-2 py-1.5 ${pkg.proprietary ? "text-amber-300" : "text-slate-400"}`}>
                    {pkg.license ?? "未声明"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 text-xs text-slate-500">
        <h2 className="text-sm font-medium text-slate-300">说明</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {offer.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
