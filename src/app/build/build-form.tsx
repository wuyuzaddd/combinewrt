"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { BuildConflict, BuildPlan } from "@/lib/build/types";
import type { BuildUiOptions, BundleOption, ThemeOption } from "@/lib/build/ui-types";
import { presetPackages } from "@/lib/build/presets";
import {
  addPackage,
  buildSubmitBody,
  defaultBuildForm,
  findProfile,
  removePackage,
  selectProfile,
  selectTarget,
  selectTheme,
  toggleBundle,
  type BuildFormState,
  type FormMode,
  type InitialBuildConfig,
  type PackageSearchItem,
  type ReleaseOption,
} from "./form-model";
import { AdvancedForm, SimpleForm, type FormSectionProps } from "./form-sections";
import { PackagePicker } from "./package-picker";
import { PlanPreview } from "./plan-preview";
import type { SourceWatchSummary } from "./source-watch-panel";

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

  const profile = findProfile(ui, form.targetId, form.profileId);
  const kernelLine = profile?.kernelLines.find((line) => line.id === form.kernelLine);

  function resetPlan() {
    setPlan(null);
    setConflicts([]);
    setIssues([]);
    setError("");
  }

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

  function onToggleBundle(bundle: BundleOption) {
    setForm((current) => toggleBundle(current, ui, bundle));
    resetPlan();
  }

  function onSelectTheme(theme: ThemeOption) {
    setForm((current) => selectTheme(current, theme));
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
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const params = new URLSearchParams({
          q: search.trim(),
          limit: "10",
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
        const data = (await response.json()) as { items: PackageSearchItem[] };
        setResults(data.items);
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
      onRemove={removePackageName}
      onRemovePackagesText={(value) => patch({ removePackages: parseRemoveList(value) })}
      onSearch={setSearch}
      onSelectTheme={onSelectTheme}
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
            disabled={busy || password.length < 8}
            type="submit"
          >
            {busy ? "生成中…" : "生成构建计划"}
          </button>
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
