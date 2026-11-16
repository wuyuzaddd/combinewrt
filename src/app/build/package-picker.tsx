"use client";

import type { ReactNode } from "react";
import type { BuildUiOptions, BundleOption, ThemeOption } from "@/lib/build/ui-types";
import type { BuildFormState, PackageSearchItem } from "./form-model";
import { i18nBadges, sourceLabel } from "./form-model";

const CATEGORY_LABELS: Record<string, string> = {
  proxy: "代理",
  nas: "NAS",
  download: "下载",
  monitor: "监控",
  theme: "主题",
  system: "系统",
};

interface Props {
  ui: BuildUiOptions;
  form: BuildFormState;
  search: string;
  onSearch: (value: string) => void;
  results: PackageSearchItem[];
  searching: boolean;
  custom: string;
  onCustom: (value: string) => void;
  onAddCustom: () => void;
  onAdd: (name: string) => void;
  onRemove: (name: string) => void;
  onPreset: (name: "minimal" | "common") => void;
  onToggleBundle: (bundle: BundleOption) => void;
  onSelectTheme: (theme: ThemeOption) => void;
  showBundlesAndThemes: boolean;
  removePackagesText: string;
  onRemovePackagesText: (value: string) => void;
}

const inputClass =
  "mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500";

function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "amber" | "emerald" }) {
  const classes =
    tone === "amber"
      ? "border-amber-800 text-amber-300"
      : tone === "emerald"
        ? "border-emerald-800 text-emerald-300"
        : "border-slate-700 text-slate-400";
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] ${classes}`}>{children}</span>;
}

export function PackagePicker(props: Props) {
  const {
    ui,
    form,
    search,
    onSearch,
    results,
    searching,
    custom,
    onCustom,
    onAddCustom,
    onAdd,
    onRemove,
    onPreset,
    onToggleBundle,
    onSelectTheme,
    showBundlesAndThemes,
    removePackagesText,
    onRemovePackagesText,
  } = props;

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-medium">软件包</h2>
        <span className="text-xs text-slate-500">已选 {form.packages.length} 个</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:border-emerald-500"
          onClick={() => onPreset("common")}
          type="button"
        >
          常用组合
        </button>
        <button
          className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:border-emerald-500"
          onClick={() => onPreset("minimal")}
          type="button"
        >
          最小系统
        </button>
      </div>

      <div className="mt-3 flex min-h-8 flex-wrap gap-2">
        {form.packages.length === 0 ? (
          <span className="text-xs text-slate-500">还没有选择软件包。</span>
        ) : (
          form.packages.map((name) => (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-200"
              key={name}
            >
              {name}
              <button
                aria-label={`移除 ${name}`}
                className="text-slate-400 hover:text-rose-300"
                onClick={() => onRemove(name)}
                type="button"
              >
                ×
              </button>
            </span>
          ))
        )}
      </div>

      <div className="mt-4 space-y-2">
        {ui.commonGroups.map((group) => (
          <details className="rounded-lg border border-slate-800 bg-slate-950/40 p-2" key={group.id}>
            <summary className="cursor-pointer text-xs text-slate-300">
              {group.title}
              <span className="ml-2 text-slate-500">{group.packages.length} 个</span>
              {group.description ? (
                <span className="ml-2 text-slate-500">· {group.description}</span>
              ) : null}
            </summary>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {group.packages.map((pkg) => {
                const selected = form.packages.includes(pkg.name);
                return (
                  <button
                    className={`rounded-full border px-2.5 py-1 text-[11px] ${
                      selected
                        ? "border-emerald-500 bg-emerald-950/40 text-emerald-200"
                        : "border-slate-700 text-slate-300 hover:border-emerald-600"
                    }`}
                    key={pkg.name}
                    onClick={() => (selected ? onRemove(pkg.name) : onAdd(pkg.name))}
                    title={`${pkg.description}（${pkg.license} · ${sourceLabel(pkg.source)}）`}
                    type="button"
                  >
                    {pkg.name}
                  </button>
                );
              })}
            </div>
          </details>
        ))}
      </div>

      <div className="mt-4">
        <input
          className={inputClass}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="搜索软件包，至少 2 个字符"
          value={search}
        />
        {searching ? <p className="mt-1 text-xs text-slate-500">搜索中…</p> : null}
        {results.length > 0 ? (
          <ul className="mt-2 max-h-64 space-y-1 overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-2">
            {results.map((item) => (
              <li key={item.name}>
                <button
                  className="flex w-full flex-wrap items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-slate-800"
                  onClick={() => onAdd(item.name)}
                  type="button"
                >
                  <span className="font-mono text-emerald-300">{item.name}</span>
                  <span className="text-slate-500">{sourceLabel(item.source)}</span>
                  {item.license ? <span className="text-slate-600">{item.license}</span> : null}
                  {i18nBadges(item.i18nStatus).map((badge) => (
                    <Badge key={badge} tone="amber">
                      {badge}
                    </Badge>
                  ))}
                  <span className="text-slate-500">{item.description.slice(0, 80)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="mt-2 flex gap-2">
        <input
          className={inputClass}
          onChange={(event) => onCustom(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onAddCustom();
            }
          }}
          placeholder="自由文本包名（目录中不存在也可添加），回车确认"
          value={custom}
        />
        <button
          className="mt-1 shrink-0 rounded-lg border border-slate-700 px-3 text-xs text-slate-300 hover:border-emerald-500"
          onClick={onAddCustom}
          type="button"
        >
          添加
        </button>
      </div>
      <p className="mt-1 text-[11px] text-slate-500">
        只提交来源 registry 中可解析的包；目录中不存在的包会在计划阶段被拒绝。
      </p>

      <div className="mt-4">
        <label className="block text-sm text-slate-300">
          移除包
          <input
            className={inputClass}
            onChange={(event) => onRemovePackagesText(event.target.value)}
            placeholder="逗号分隔，例如 dnsmasq,libc"
            value={removePackagesText}
          />
        </label>
        <p className="mt-1 text-[11px] text-slate-500">
          移除会先经过依赖与 essentials 检查；被模式或依赖需要的包会在计划中返回冲突。
        </p>
      </div>

      {showBundlesAndThemes ? (
        <>
          <div className="mt-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">一键套餐</h3>
              <span className="text-xs text-slate-500">{ui.bundles.length} 个</span>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {ui.bundles.map((bundle) => {
                const selected = form.bundles.includes(bundle.id);
                const supported = bundle.targets.includes(form.targetId);
                return (
                  <button
                    className={`rounded-lg border p-3 text-left text-xs ${
                      selected
                        ? "border-emerald-500 bg-emerald-950/40 text-emerald-200"
                        : supported
                          ? "border-slate-700 bg-slate-950 text-slate-300 hover:border-emerald-600"
                          : "cursor-not-allowed border-slate-800 bg-slate-950/40 text-slate-600"
                    }`}
                    disabled={!supported}
                    key={bundle.id}
                    onClick={() => onToggleBundle(bundle)}
                    title={supported ? bundle.description : `套餐不支持目标 ${form.targetId}`}
                    type="button"
                  >
                    <span className="block font-medium">
                      {bundle.title}
                      <span className="ml-2 text-[10px] text-slate-500">
                        {CATEGORY_LABELS[bundle.category] ?? bundle.category}
                      </span>
                    </span>
                    <span className="mt-1 block text-[11px] text-slate-500">
                      {bundle.packages.join(", ")} · {bundle.license}
                      {bundle.publicAllowed ? "" : " · 仅私有"}
                    </span>
                    {!supported ? (
                      <span className="mt-1 block text-[11px] text-amber-400">
                        不支持目标 {form.targetId}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">主题</h3>
              <span className="text-xs text-slate-500">同一时间只选一个主题</span>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {ui.themes.map((theme) => {
                const selected = form.themePackage === theme.package;
                return (
                  <button
                    className={`overflow-hidden rounded-lg border text-left ${
                      selected ? "border-emerald-500" : "border-slate-700 hover:border-emerald-600"
                    }`}
                    key={theme.package}
                    onClick={() => onSelectTheme(theme)}
                    type="button"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img alt={`${theme.title} 预览`} className="h-20 w-full object-cover" src={theme.preview} />
                    <span className="block p-2">
                      <span className="flex items-center gap-2 text-xs font-medium text-slate-200">
                        {theme.title}
                        {theme.default ? <Badge tone="emerald">默认</Badge> : null}
                        {theme.experimental ? <Badge tone="amber">实验</Badge> : null}
                      </span>
                      <span className="mt-1 block text-[11px] text-slate-500">{theme.description}</span>
                      <span className="mt-1 block font-mono text-[11px] text-slate-500">{theme.package}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
