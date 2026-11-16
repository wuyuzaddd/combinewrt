"use client";

import type { BuildConflict, BuildPlan } from "@/lib/build/types";
import type { BuildFormState, FormMode } from "./form-model";
import { sourceLabel } from "./form-model";

function withSource(entry: { name: string; packageSource?: string | null }): string {
  return entry.packageSource ? `${entry.name} [${sourceLabel(entry.packageSource)}]` : entry.name;
}

interface Props {
  plan: BuildPlan | null;
  conflicts: BuildConflict[];
  mode: FormMode;
  form: BuildFormState;
  dispatching: boolean;
  onDispatch: () => void;
}

export function PlanPreview({ plan, conflicts, mode, form, dispatching, onDispatch }: Props) {
  const selectedEntries = plan?.resolved.filter((entry) => entry.source === "selected") ?? [];
  const dependencyEntries = plan?.resolved.filter((entry) => entry.source === "dependency") ?? [];
  const unknownSelected = selectedEntries.filter((entry) => entry.version === null);
  const isV2 = plan?.schemaVersion === 2;

  return (
    <aside className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-medium">计划预览</h2>
        {isV2 ? <span className="text-xs text-slate-500">V2 计划 · 提交后进入队列</span> : null}
      </div>
      {!plan && (
        <p className="text-sm text-slate-500">
          填写左侧表单并生成计划后，这里会显示模式展开、包解析、feed set 与预计产物。
        </p>
      )}
      {plan && (
        <>
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm">
            <p className="text-xs uppercase tracking-wider text-slate-500">预计产物</p>
            <p className="mt-1 break-all font-mono text-emerald-300">{plan.artifactName}</p>
            <p className="mt-3 text-xs text-slate-500">设备 · 格式</p>
            <p className="text-slate-200">
              {plan.profileTitle} · {plan.imageType}
            </p>
            {plan.schemaVersion === 2 ? (
              <div className="mt-2 grid gap-x-4 gap-y-1 text-xs text-slate-400 sm:grid-cols-2">
                <p>target：{plan.target.id}</p>
                {mode === "advanced" ? (
                  <p>内核：{plan.kernelLine.id}（{plan.kernelLine.engine}）</p>
                ) : null}
                <p>
                  变体：{plan.imageVariant.boot} / {plan.imageVariant.filesystem} / {plan.imageVariant.artifact}
                </p>
                <p>通道：{plan.channel}</p>
              </div>
            ) : null}
            <p className="mt-3 text-xs text-slate-500">直接选择（{selectedEntries.length}）</p>
            <p className="text-slate-300">{selectedEntries.map(withSource).join(", ") || "（无）"}</p>
            {unknownSelected.length > 0 && (
              <p className="mt-1 text-xs text-amber-300">
                目录中未找到：{unknownSelected.map((entry) => entry.name).join(", ")}（构建时可能失败）
              </p>
            )}
            <p className="mt-3 text-xs text-slate-500">自动依赖（{dependencyEntries.length}）</p>
            <p className="text-slate-400">
              {dependencyEntries.slice(0, 30).map(withSource).join(", ")}
              {dependencyEntries.length > 30 ? ` … +${dependencyEntries.length - 30}` : ""}
            </p>
          </div>

          {plan.schemaVersion === 2 && plan.modes ? (
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm">
              <p className="text-xs uppercase tracking-wider text-slate-500">模式展开</p>
              <p className="mt-1 text-slate-200">
                基础 preset：{plan.modes.basePreset.title}（{plan.modes.basePreset.id}）
              </p>
              {plan.modes.overlays.length > 0 ? (
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {plan.modes.overlays.map((overlay) => (
                    <li
                      className={`rounded-full border px-2.5 py-1 text-[11px] ${
                        overlay.experimental
                          ? "border-amber-800 text-amber-300"
                          : "border-slate-700 text-slate-300"
                      }`}
                      key={overlay.id}
                    >
                      {overlay.title}
                      {overlay.experimental ? " · 实验" : ""}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-xs text-slate-500">没有 overlay。</p>
              )}
              {plan.modes.generatedFiles.length > 0 ? (
                <p className="mt-2 break-all font-mono text-[11px] text-slate-500">
                  生成文件：{plan.modes.generatedFiles.join(", ")}
                </p>
              ) : null}
              <p className="mt-1 text-[11px] text-slate-500">
                文件内容不在预览中回显（可能包含 per-build secret）。
              </p>
            </div>
          ) : null}

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm">
            <p className="text-xs uppercase tracking-wider text-slate-500">
              移除包（{form.removePackages.length}）
            </p>
            <p className="mt-1 break-all text-slate-300">
              {form.removePackages.length > 0 ? form.removePackages.join(", ") : "未请求移除"}
            </p>
            {plan.warnings && plan.warnings.length > 0 ? (
              <ul className="mt-2 space-y-1 text-[11px] text-amber-300">
                {plan.warnings.slice(0, 8).map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
          </div>

          {plan.schemaVersion === 2 && plan.feedSet ? (
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm">
              <p className="text-xs uppercase tracking-wider text-slate-500">镜像 feed set</p>
              <p className="mt-1 text-slate-300">
                {plan.feedSet.visibility === "public" ? "公开" : "私有"} · {plan.feedSet.repositories.length} 个仓库
              </p>
              <ul className="mt-1 space-y-0.5 break-all font-mono text-[11px] text-slate-500">
                {plan.feedSet.repositories.map((repository) => (
                  <li key={repository.id}>
                    {repository.id} · {repository.signed ? "signed" : "unsigned"}
                  </li>
                ))}
              </ul>
              <p className="mt-1 break-all font-mono text-[11px] text-slate-500">
                {plan.feedSet.repositories[0]?.url ?? "—"}
              </p>
            </div>
          ) : null}

          {plan.missingDependencies.length > 0 && (
            <p className="rounded-lg border border-amber-900 bg-amber-950/30 p-3 text-xs text-amber-200">
              目录中缺少依赖：{plan.missingDependencies.join(", ")}（构建时可能失败）
            </p>
          )}

          {plan.compliance && !plan.compliance.publicEligible && (
            <p className="rounded-lg border border-amber-900 bg-amber-950/30 p-3 text-xs text-amber-200">
              含专有/无许可证包，仅限自用，不进入公开镜像。
            </p>
          )}

          {!isV2 ? (
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <p className="text-xs uppercase tracking-wider text-slate-500">生成文件</p>
              {plan.files.map((file) => (
                <div className="mt-2" key={file.path}>
                  <p className="font-mono text-xs text-emerald-300">
                    {file.path} · 0{file.mode.toString(8)}
                  </p>
                  <pre className="mt-1 max-h-64 overflow-auto rounded bg-slate-950 p-2 text-xs text-slate-300">
                    {file.content}
                  </pre>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <p className="text-xs uppercase tracking-wider text-slate-500">
                生成文件路径（{plan.files.length}）
              </p>
              {plan.files.map((file) => (
                <p className="mt-1 break-all font-mono text-xs text-emerald-300" key={file.path}>
                  {file.path}
                </p>
              ))}
            </div>
          )}

          {mode === "advanced" ? (
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <p className="text-xs uppercase tracking-wider text-slate-500">ImageBuilder 命令</p>
              <pre className="mt-1 overflow-auto rounded bg-slate-950 p-2 text-xs text-slate-300">
                {plan.imageBuilderCommand}
              </pre>
            </div>
          ) : null}

          {conflicts.length > 0 && (
            <ul className="rounded-lg border border-rose-900 bg-rose-950/40 p-3 text-sm text-rose-200">
              {conflicts.map((conflict) => (
                <li key={conflict.names.join(",")}>{conflict.message}</li>
              ))}
            </ul>
          )}

          <button
            className="w-full rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-emerald-950 disabled:opacity-50"
            disabled={dispatching || conflicts.length > 0 || plan.conflicts.length > 0}
            onClick={onDispatch}
            type="button"
          >
            {dispatching ? "派发中…" : "开始构建"}
          </button>
        </>
      )}
    </aside>
  );
}
