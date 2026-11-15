import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth/current-session";
import { formatSize } from "@/lib/catalog/format";
import { getBuildService } from "@/lib/builds";
import { createComplianceReport } from "@/lib/compliance";
import { ComplianceIssueList } from "@/components/compliance";
import { BuildPoller } from "./build-poller";
import { CancelButton } from "../cancel-button";

const STEP_LABELS: Record<string, string> = {
  "prepare-plan": "生成构建计划",
  "download-imagebuilder": "下载 ImageBuilder",
  "download-packages": "下载并校验软件包",
  "write-files": "写入构建配置",
  "build-image": "构建镜像",
  "assert-packages": "校验镜像内软件包",
  "package-artifact": "打包产物",
  dispatch: "派发构建",
  timeout: "构建超时",
  workflow: "工作流",
};

export default async function BuildDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect(`/login?next=/builds/${id}`);
  const build = await getBuildService().refresh(id);
  if (!build) notFound();

  const active = build.status === "queued" || build.status === "running";
  const compliance = build.plan.compliance ?? createComplianceReport(build.plan.resolved);

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-6 py-12">
      <BuildPoller active={active} />
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-400">build</p>
          <h1 className="mt-2 break-all font-mono text-lg font-semibold">{build.plan.artifactName}</h1>
          <p className="mt-1 text-xs text-slate-500">
            {build.plan.profileTitle} · {build.plan.imageType} · {build.adapter} · run {build.runId ?? "—"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-200">{build.status}</span>
          {active && <CancelButton buildId={build.id} />}
          <Link
            className="text-emerald-300 underline decoration-emerald-800"
            href={`/builds/${build.id}/source-offer`}
          >
            源码清单
          </Link>
          <Link
            className="text-emerald-300 underline decoration-emerald-800"
            href={`/build?from=${build.id}`}
          >
            按此配置重建
          </Link>
          <Link className="text-slate-400" href="/builds">
            返回
          </Link>
        </div>
      </header>

      {build.failure && (
        <section className="rounded-xl border border-rose-900 bg-rose-950/40 p-4 text-sm text-rose-200">
          <p className="text-xs uppercase tracking-wider text-rose-300">失败定位</p>
          <p className="mt-2 font-medium">
            步骤：{STEP_LABELS[build.failure.step] ?? build.failure.step}
          </p>
          {(build.failure.package || build.failure.source || build.failure.version) && (
            <p className="mt-1 break-all font-mono text-xs text-rose-100">
              {build.failure.package ? `package=${build.failure.package}` : ""}
              {build.failure.source ? ` source=${build.failure.source}` : ""}
              {build.failure.version ? ` version=${build.failure.version}` : ""}
            </p>
          )}
          <p className="mt-2 text-xs text-rose-200/90">{build.failure.message}</p>
        </section>
      )}

      {build.error && !build.failure && (
        <p className="rounded-xl border border-rose-900 bg-rose-950/40 p-4 text-sm text-rose-200">{build.error}</p>
      )}

      <section
        className={`rounded-xl border p-4 text-sm ${
          compliance.publicEligible
            ? "border-emerald-900 bg-emerald-950/20 text-emerald-200"
            : "border-amber-900 bg-amber-950/30 text-amber-200"
        }`}
      >
        <p className="font-medium">
          {compliance.publicEligible ? "许可证检查通过（可公开分发）" : "含专有/无许可证包，仅限自用，不进入公开镜像"}
        </p>
        {compliance.issues.length > 0 && (
          <ComplianceIssueList issues={compliance.issues} className="mt-2 space-y-1 text-xs" />
        )}
        <Link className="mt-2 inline-block text-xs underline decoration-amber-700" href={`/builds/${build.id}/source-offer`}>
          查看完整 source offer
        </Link>
      </section>

      {build.status === "succeeded" && !build.artifactName && (
        <p className="rounded-xl border border-amber-900 bg-amber-950/30 p-4 text-sm text-amber-200">
          工作流已结束，但没有找到可下载的产物。请检查工作流日志中的 package-artifact 步骤。
        </p>
      )}

      {build.status === "succeeded" && build.artifactName && (
        <div className="flex flex-col gap-2">
          <a
            className="w-fit rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-emerald-950"
            href={`/api/builds/${build.id}/artifact`}
          >
            下载产物（{build.artifactName}）
          </a>
          <p className="break-all font-mono text-xs text-slate-500">
            {build.artifactSha256 ? `sha256 ${build.artifactSha256}` : "sha256 尚未记录"}
            {build.artifactSize ? ` · ${formatSize(build.artifactSize)}` : ""}
          </p>
        </div>
      )}

      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <p className="text-xs uppercase tracking-wider text-slate-500">日志尾部</p>
        <pre className="mt-2 max-h-96 overflow-auto rounded bg-slate-950 p-3 text-xs text-slate-300">
          {build.logTail || "（暂无日志）"}
        </pre>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm">
        <p className="text-xs uppercase tracking-wider text-slate-500">构建配置</p>
        {build.config ? (
          <dl className="mt-2 grid gap-x-6 gap-y-1 text-slate-300 sm:grid-cols-2">
            <div><dt className="inline text-slate-500">hostname：</dt><dd className="inline font-mono">{build.config.hostname}</dd></div>
            <div><dt className="inline text-slate-500">时区：</dt><dd className="inline font-mono">{build.config.timezone}</dd></div>
            <div><dt className="inline text-slate-500">LAN：</dt><dd className="inline font-mono">{build.config.lanIp} / {build.config.netmask}</dd></div>
            <div><dt className="inline text-slate-500">镜像：</dt><dd className="inline font-mono">{build.config.imageType}</dd></div>
          </dl>
        ) : (
          <p className="mt-2 text-xs text-slate-500">旧记录没有保存表单配置。</p>
        )}
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm">
          <p className="text-xs uppercase tracking-wider text-slate-500">软件包（{build.plan.packages.length}）</p>
          <p className="mt-1 break-all text-slate-300">{build.plan.packages.join(", ")}</p>
          <p className="mt-3 text-xs text-slate-500">来源</p>
          <p className="break-all text-xs text-slate-400">{build.plan.sourceNote}</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm">
          <p className="text-xs uppercase tracking-wider text-slate-500">生成文件</p>
          {build.plan.files.map((file) => (
            <p className="mt-1 break-all font-mono text-xs text-emerald-300" key={file.path}>
              {file.path}
            </p>
          ))}
        </div>
      </section>
    </main>
  );
}
