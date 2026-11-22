"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { BuildConflict, BuildPlan } from "@/lib/build/types";
import type { BuildUiOptions, BundleOption } from "@/lib/build/ui-types";
import { presetPackages } from "@/lib/build/presets";
import {
  addPackage,
  buildSubmitBody,
  defaultBuildForm,
  findProfile,
  removePackage,
  selectProfile,
  selectTarget,
  selectDefaultTheme,
  toggleThemePackage,
  toggleBundle,
  validateBuildForm,
  type BuildFormState,
  type FormIssue,
  type FormMode,
  type InitialBuildConfig,
  type PackageSearchItem,
  type ReleaseOption,
} from "./form-model";
import { AdvancedForm, SimpleForm, type FormSectionProps } from "./form-sections";
import { PackagePicker } from "./package-picker";
import { PlanPreview } from "./plan-preview";
import type { SourceWatchSummary } from "./source-watch-panel";

/**
 * Unfinished form state lives in this browser, not on the server: a refused or
 * abandoned attempt (wrong password, a missing field, a closed tab) should not
 * throw away what the user typed. The root password is deliberately excluded.
 */
const DRAFT_KEY = "combinewrt.build.draft.v1";

interface Props {
  ui: BuildUiOptions;
  releases: ReleaseOption[];
  baseVersion: string;
  initialConfig: InitialBuildConfig | null;
  sourceWatch: SourceWatchSummary;
  fromBuildId: string | null;
}

function parseRemoveList(value: string): string[] {
  return [...new Set(value.split(/[,\s]+/).map((item) => item.trim()).filter(Boolean))];
}

export function BuildForm({ ui, releases, baseVersion, initialConfig, sourceWatch, fromBuildId }: Props) {
  const router = useRouter();
  const [form, setForm] = useState<BuildFormState>(() => defaultBuildForm(ui, releases, initialConfig));
  const [password, setPassword] = useState("");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<PackageSearchItem[]>([]);
  const [resultsTotal, setResultsTotal] = useState(0);
  const [searching, setSearching] = useState(false);
  const [custom, setCustom] = useState("");
  const [targetQuery, setTargetQuery] = useState("");
  const [capability, setCapability] = useState("");
  const [plan, setPlan] = useState<BuildPlan | null>(null);
  const [conflicts, setConflicts] = useState<BuildConflict[]>([]);
  const [issues, setIssues] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [formIssues, setFormIssues] = useState<FormIssue[]>([]);
  const [restoredAt, setRestoredAt] = useState<string | null>(null);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const firstRender = useRef(true);
  const restored = useRef(false);

  const profile = findProfile(ui, form.targetId, form.profileId);
  const kernelLine = profile?.kernelLines.find((line) => line.id === form.kernelLine);

  function resetPlan() {
    setPlan(null);
    setConflicts([]);
    setIssues([]);
    setError("");
    setFormIssues([]);
  }

  function persistDraft(): string | null {
    const savedAt = new Date().toISOString();
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ savedAt, form }));
      setDraftSavedAt(savedAt);
      return savedAt;
    } catch {
      return null;
    }
  }

  function clearDraft() {
    try {
      window.localStorage.removeItem(DRAFT_KEY);
    } catch {
      // storage disabled; nothing to clear
    }
    setRestoredAt(null);
    setDraftSavedAt(null);
  }

  // Restore an unfinished draft once, unless the page was opened from an
  // existing build (that config is the explicit starting point).
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    if (initialConfig) return;
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { savedAt?: string; form?: Partial<BuildFormState> };
      if (!parsed?.form) return;
      // Restoring the draft is a one-time client-only sync after mount.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is not available during render
      setForm((current) => ({ ...current, ...parsed.form }));
      setRestoredAt(parsed.savedAt ?? new Date().toISOString());
    } catch {
      // a corrupted draft is ignored rather than blocking the form
    }
  }, [initialConfig]);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    persistDraft();
    // persistDraft reads the latest state; `form` is the dependency that matters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  function update<K extends keyof BuildFormState>(key: K, value: BuildFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    resetPlan();
  }

  function patch(next: Partial<BuildFormState>) {
    setForm((current) => ({ ...current, ...next }));
    resetPlan();
  }

  function setMode(mode: FormMode) {
    setForm((current) => ({ ...current, mode }));
  }

  function addPackageName(name: string) {
    setForm((current) => addPackage(current, name));
    resetPlan();
  }

  function removePackageName(name: string) {
    setForm((current) => removePackage(current, name));
    resetPlan();
  }

  function onTargetProfile(targetId: string, profileId: string) {
    setForm((current) => selectProfile(selectTarget(current, ui, targetId), ui, profileId));
    resetPlan();
  }

  function onPreset(name: "minimal" | "common") {
    setForm((current) => ({ ...current, packages: [...presetPackages(name)] }));
    resetPlan();
  }

  // "个人常用" is the favorites list in config/presets/common-v2.json (it may
  // reference packages curated in any group, plus themes); applying it adds the
  // whole list without dropping anything the user already picked.
  function onFavorites() {
    setForm((current) => ({
      ...current,
      packages: [...new Set([...current.packages, ...ui.favorites])],
    }));
    resetPlan();
  }

  function onToggleBundle(bundle: BundleOption) {
    setForm((current) => toggleBundle(current, ui, bundle));
    resetPlan();
  }

  function onToggleTheme(name: string) {
    setForm((current) => toggleThemePackage(current, name));
    resetPlan();
  }

  function onSelectDefaultTheme(name: string | null) {
    setForm((current) => selectDefaultTheme(current, name));
    resetPlan();
  }

  function onAddCustom() {
    const name = custom.trim();
    if (!name) return;
    addPackageName(name);
    setCustom("");
  }

  // Package search is scoped to the current target and kernel line; extension
  // packages are included and labelled with their source/i18n badges.
  useEffect(() => {
    if (search.trim().length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing results for an empty query
      setResults([]);
      setResultsTotal(0);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const params = new URLSearchParams({
          q: search.trim(),
          limit: "50",
          target: form.targetId,
          kernelLine: form.kernelLine,
          includeExtension: "1",
        });
        const response = await fetch(`/api/catalog/packages?${params.toString()}`, {
          signal: controller.signal,
        });
        if (response.status === 401) {
          router.push("/login?next=/build");
          return;
        }
        if (!response.ok) return;
        const data = (await response.json()) as { items: PackageSearchItem[]; total?: number };
        setResults(data.items);
        setResultsTotal(data.total ?? data.items.length);
      } catch {
        // aborted or offline
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, form.targetId, form.kernelLine, router]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const problems = validateBuildForm(form, ui, password);
    if (problems.length > 0) {
      setBusy(false);
      setFormIssues(problems);
      const savedAt = persistDraft();
      setError(
        `还有 ${problems.length} 项需要处理；当前配置${
          savedAt ? `已保存到本浏览器（${new Date(savedAt).toLocaleString("zh-CN")}）` : "保存失败（浏览器存储不可用）"
        }，改好后直接重试即可。`,
      );
      return;
    }
    setBusy(true);
    resetPlan();

    try {
      const response = await fetch("/api/build/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildSubmitBody(form, ui, password)),
      });
      const data = (await response.json()) as {
        ok: boolean;
        plan?: BuildPlan;
        conflicts?: BuildConflict[];
        issues?: string[];
        error?: string;
      };
      if (response.status === 401) {
        router.push("/login?next=/build");
        return;
      }
      if (response.status === 409) {
        setPlan(data.plan ?? null);
        setConflicts(data.conflicts ?? []);
        setError(data.error ?? "");
        return;
      }
      if (!response.ok) {
        setIssues(data.issues ?? []);
        setError(data.error ?? "构建计划生成失败");
        return;
      }
      setPlan(data.plan ?? null);
      setConflicts(data.conflicts ?? []);
    } catch {
      setError("请求失败，请检查网络后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function dispatchBuild() {
    if (!plan || plan.conflicts.length > 0 || conflicts.length > 0) return;
    const problems = validateBuildForm(form, ui, password);
    if (problems.length > 0) {
      setFormIssues(problems);
      persistDraft();
      setError(`还有 ${problems.length} 项需要处理，本次没有派发构建；配置已保存到本浏览器。`);
      return;
    }
    setFormIssues([]);
    setDispatching(true);
    setError("");

    try {
      const response = await fetch("/api/builds", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildSubmitBody(form, ui, password)),
      });
      const data = (await response.json()) as {
        ok: boolean;
        build?: { id: string };
        issues?: string[];
        conflicts?: BuildConflict[];
        error?: string;
      };
      if (response.status === 401) {
        router.push("/login?next=/build");
        return;
      }
      if (!response.ok) {
        setIssues(data.issues ?? []);
        setConflicts(data.conflicts ?? []);
        setError(data.error ?? "构建派发失败");
        return;
      }
      router.push(`/builds/${data.build!.id}`);
    } catch {
      setError("请求失败，请检查网络后重试。");
    } finally {
      setDispatching(false);
    }
  }

  const removePackagesText = form.removePackages.join(", ");
  const picker = (
    <PackagePicker
      custom={custom}
      form={form}
      onAdd={addPackageName}
      onAddCustom={onAddCustom}
      onCustom={setCustom}
      onPreset={onPreset}
      onFavorites={onFavorites}
      onRemove={removePackageName}
      onRemovePackagesText={(value) => patch({ removePackages: parseRemoveList(value) })}
      onSearch={setSearch}
      onToggleTheme={onToggleTheme}
      onSelectDefaultTheme={onSelectDefaultTheme}
      resultsTotal={resultsTotal}
      onToggleBundle={onToggleBundle}
      removePackagesText={removePackagesText}
      results={results}
      search={search}
      searching={searching}
      showBundlesAndThemes={form.mode === "advanced"}
      ui={ui}
    />
  );

  const sectionProps: FormSectionProps = {
    ui,
    form,
    releases,
    password,
    onPassword: (value) => {
      setPassword(value);
      resetPlan();
    },
    targetQuery,
    onTargetQuery: setTargetQuery,
    capability,
    onCapability: setCapability,
    onTargetProfile,
    update,
    patch,
    picker,
  };

  const modeContext = useMemo(
    () => ({
      filesystem: form.variant.filesystem,
      artifact: form.variant.artifact,
      capabilities: profile?.capabilities ?? [],
      basePresetFeatures: ui.basePresets.find((preset) => preset.id === form.basePreset)?.features ?? [],
      selectedModeIds: form.modes,
      selectedPackages: form.packages,
    }),
    [form.variant.filesystem, form.variant.artifact, form.basePreset, form.modes, form.packages, profile, ui.basePresets],
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
        <div className="flex gap-2" role="tablist" aria-label="构建模式">
          {(
            [
              { value: "simple", label: "Simple 模式", hint: "日常构建：目标、release、镜像变体、preset、包" },
              {
                value: "advanced",
                label: "Advanced 模式",
                hint: "内核线、模式叠加、typed 网络、pins、feed set、来源监视",
              },
            ] as const
          ).map((tab) => (
            <button
              aria-pressed={form.mode === tab.value}
              className={`rounded-lg px-3 py-1.5 text-sm ${
                form.mode === tab.value
                  ? "bg-emerald-500 text-emerald-950"
                  : "border border-slate-700 text-slate-300 hover:border-emerald-600"
              }`}
              key={tab.value}
              onClick={() => setMode(tab.value)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-500">
          目录基线 {baseVersion} · {profile?.title ?? "未选择 profile"} ·{" "}
          {form.mode === "advanced"
            ? `内核 ${kernelLine ? `${kernelLine.id}（${kernelLine.engine}）` : form.kernelLine}`
            : `release ${form.release}`}
        </p>
      </div>

      <div className="grid gap-8 xl:grid-cols-[1.15fr_0.85fr]">
        <form className="space-y-6" onSubmit={submit}>
          {form.mode === "simple" ? (
            <SimpleForm {...sectionProps} />
          ) : (
            <AdvancedForm
              {...sectionProps}
              fromBuildId={fromBuildId}
              modeContext={modeContext}
              sourceWatch={sourceWatch}
            />
          )}

          {restoredAt && !initialConfig ? (
            <p className="rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-xs text-slate-400">
              已恢复 {new Date(restoredAt).toLocaleString("zh-CN")} 保存在本浏览器的配置（不包含 root 密码）。
              <button className="ml-2 underline hover:text-slate-200" onClick={clearDraft} type="button">
                清除草稿
              </button>
            </p>
          ) : null}

          {formIssues.length > 0 ? (
            <div className="rounded-lg border border-rose-900 bg-rose-950/40 p-3 text-sm text-rose-200">
              <p className="font-medium">还有 {formIssues.length} 项需要处理：</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {formIssues.map((issue) => (
                  <li key={issue.field}>
                    <span className="text-rose-100">{issue.label}</span>：{issue.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {error && <p className="rounded-lg border border-rose-900 bg-rose-950/40 p-3 text-sm text-rose-200">{error}</p>}
          {issues.length > 0 && (
            <ul className="rounded-lg border border-amber-900 bg-amber-950/30 p-3 text-sm text-amber-200">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}

          <button
            className="w-full rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-emerald-950 disabled:opacity-50"
            disabled={busy}
            type="submit"
          >
            {busy ? "生成中…" : "生成构建计划"}
          </button>
          <p className="text-xs text-slate-500">
            点击后会先在浏览器里检查表单：缺项或填错会逐条列在上面并拒绝生成，同时把当前配置保存在本浏览器
            {draftSavedAt ? `（上次保存 ${new Date(draftSavedAt).toLocaleString("zh-CN")}）` : ""}。
          </p>
        </form>

        <PlanPreview
          conflicts={conflicts}
          dispatching={dispatching}
          form={form}
          mode={form.mode}
          onDispatch={dispatchBuild}
          plan={plan}
        />
      </div>
    </div>
  );
}
