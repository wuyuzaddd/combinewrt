"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { CatalogPackage, CatalogProfile } from "@/lib/catalog/types";
import type { BuildConflict, BuildConfig, BuildPlan } from "@/lib/build/types";
import { presetPackages } from "@/lib/build/presets";

const STORAGE_KEY = "combinewrt.build-form";

interface FormState {
  profile: string;
  imageType: string;
  hostname: string;
  timezone: string;
  lanIp: string;
  netmask: string;
  packages: string[];
}

interface Props {
  baseVersion: string;
  profiles: CatalogProfile[];
  initialConfig?: BuildConfig | null;
}

function defaultForm(profiles: CatalogProfile[], initial?: BuildConfig | null): FormState {
  const profile = profiles.find((item) => item.id === initial?.profile) ?? profiles[0];
  const imageType =
    initial && profile?.formats.includes(initial.imageType) ? initial.imageType : profile?.formats[0] ?? "ext4-efi";
  return {
    profile: profile?.id ?? "generic",
    imageType,
    hostname: initial?.hostname ?? "ImmortalWrt",
    timezone: initial?.timezone ?? "Asia/Shanghai",
    lanIp: initial?.lanIp ?? "192.168.1.1",
    netmask: initial?.netmask ?? "255.255.255.0",
    packages: initial ? [...initial.packages] : [...presetPackages("common")],
  };
}

const inputClass =
  "mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500";

export function BuildForm({ baseVersion, profiles, initialConfig }: Props) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => defaultForm(profiles, initialConfig));
  const [password, setPassword] = useState("");
  const [search, setSearch] = useState("");
  const [custom, setCustom] = useState("");
  const [results, setResults] = useState<Pick<CatalogPackage, "name" | "description">[]>([]);
  const [plan, setPlan] = useState<BuildPlan | null>(null);
  const [conflicts, setConflicts] = useState<BuildConflict[]>([]);
  const [issues, setIssues] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (initialConfig) {
      setHydrated(true);
      return;
    }
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<FormState>;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable after mount
        setForm((current) => ({
          ...current,
          ...parsed,
          packages: Array.isArray(parsed.packages) ? parsed.packages : current.packages,
        }));
      }
    } catch {
      // ignore corrupt local state
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const { packages, ...rest } = form;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...rest, packages }));
  }, [form, hydrated]);

  useEffect(() => {
    if (search.trim().length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/catalog/packages?q=${encodeURIComponent(search.trim())}&limit=10`, {
          signal: controller.signal,
        });
        if (response.status === 401) {
          router.push("/login?next=/build");
          return;
        }
        if (!response.ok) return;
        const data = (await response.json()) as { items: Pick<CatalogPackage, "name" | "description">[] };
        setResults(data.items);
      } catch {
        // aborted or offline
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, router]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setPlan(null);
  }

  function editForm(mutator: (current: FormState) => FormState) {
    setForm(mutator);
    setPlan(null);
  }

  function addCustom() {
    const name = custom.trim();
    if (!name) return;
    addPackage(name);
    setCustom("");
  }

  function addPackage(name: string) {
    editForm((current) =>
      current.packages.includes(name) ? current : { ...current, packages: [...current.packages, name] },
    );
  }

  function removePackage(name: string) {
    editForm((current) => ({ ...current, packages: current.packages.filter((item) => item !== name) }));
  }

  function selectProfile(profileId: string) {
    const profile = profiles.find((item) => item.id === profileId);
    const formats: string[] = profile?.formats ?? [];
    editForm((current) => ({
      ...current,
      profile: profileId,
      imageType: formats.includes(current.imageType) ? current.imageType : (formats[0] ?? current.imageType),
    }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setPlan(null);
    setConflicts([]);
    setIssues([]);
    setError("");

    try {
      const response = await fetch("/api/build/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, rootPassword: password }),
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
    } catch {
      setError("请求失败，请检查网络后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function dispatchBuild() {
    if (!plan || plan.conflicts.length > 0) return;
    setDispatching(true);
    setError("");

    try {
      const response = await fetch("/api/builds", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, rootPassword: password }),
      });
      const data = (await response.json()) as { ok: boolean; build?: { id: string }; issues?: string[]; error?: string };
      if (response.status === 401) {
        router.push("/login?next=/build");
        return;
      }
      if (!response.ok) {
        setIssues(data.issues ?? []);
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

  const activeProfile = profiles.find((item) => item.id === form.profile);
  const formats = activeProfile?.formats ?? [];
  const selectedEntries = plan?.resolved.filter((entry) => entry.source === "selected") ?? [];
  const dependencyEntries = plan?.resolved.filter((entry) => entry.source === "dependency") ?? [];
  const unknownSelected = selectedEntries.filter((entry) => entry.version === null);

  return (
    <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
      <form className="space-y-6" onSubmit={submit}>
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
          <h2 className="font-medium">设备与格式</h2>
          <p className="mt-1 text-xs text-slate-500">基线 {baseVersion} · 仅 x86_64</p>

          <label className="mt-4 block text-sm text-slate-300">
            设备/Profile
            <select className={inputClass} value={form.profile} onChange={(event) => selectProfile(event.target.value)}>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.title}
                </option>
              ))}
            </select>
          </label>

          <div className="mt-4">
            <span className="text-sm text-slate-300">镜像格式</span>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {formats.map((format) => (
                <label
                  className={`cursor-pointer rounded-lg border p-3 text-sm ${
                    form.imageType === format
                      ? "border-emerald-500 bg-emerald-950/40 text-emerald-200"
                      : "border-slate-700 bg-slate-950 text-slate-300"
                  }`}
                  key={format}
                >
                  <input
                    checked={form.imageType === format}
                    className="sr-only"
                    name="imageType"
                    onChange={() => update("imageType", format)}
                    type="radio"
                  />
                  {format}
                </label>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
          <h2 className="font-medium">系统设置</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block text-sm text-slate-300">
              Hostname
              <input
                className={inputClass}
                onChange={(event) => update("hostname", event.target.value)}
                value={form.hostname}
              />
            </label>
            <label className="block text-sm text-slate-300">
              时区
              <input
                className={inputClass}
                onChange={(event) => update("timezone", event.target.value)}
                placeholder="Asia/Shanghai"
                value={form.timezone}
              />
            </label>
            <label className="block text-sm text-slate-300">
              LAN IP
              <input className={inputClass} onChange={(event) => update("lanIp", event.target.value)} value={form.lanIp} />
            </label>
            <label className="block text-sm text-slate-300">
              子网掩码
              <input
                className={inputClass}
                onChange={(event) => update("netmask", event.target.value)}
                value={form.netmask}
              />
            </label>
          </div>
          <label className="mt-4 block text-sm text-slate-300">
            Root 密码
            <input
              autoComplete="new-password"
              className={inputClass}
              onChange={(event) => {
                setPassword(event.target.value);
                setPlan(null);
              }}
              placeholder="8–128 字符，不会保存到浏览器"
              type="password"
              value={password}
            />
          </label>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-medium">软件包</h2>
            <span className="text-xs text-slate-500">已选 {form.packages.length} 个</span>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:border-emerald-500"
              onClick={() => update("packages", [...presetPackages("common")])}
              type="button"
            >
              常用组合
            </button>
            <button
              className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:border-emerald-500"
              onClick={() => update("packages", [...presetPackages("minimal")])}
              type="button"
            >
              最小系统
            </button>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {form.packages.map((name) => (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-200"
                key={name}
              >
                {name}
                <button aria-label={`移除 ${name}`} className="text-slate-400 hover:text-rose-300" onClick={() => removePackage(name)} type="button">
                  ×
                </button>
              </span>
            ))}
          </div>

          <input
            className={inputClass}
            onChange={(event) => {
              setSearch(event.target.value);
              if (event.target.value.trim().length < 2) setResults([]);
            }}
            placeholder="搜索软件包，至少 2 个字符"
            value={search}
          />
          <div className="mt-2 flex gap-2">
            <input
              className={inputClass}
              onChange={(event) => setCustom(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addCustom();
                }
              }}
              placeholder="自由文本包名（目录中不存在也可添加），回车确认"
              value={custom}
            />
            <button
              className="mt-1 shrink-0 rounded-lg border border-slate-700 px-3 text-xs text-slate-300 hover:border-emerald-500"
              onClick={addCustom}
              type="button"
            >
              添加
            </button>
          </div>
          {results.length > 0 && (
            <ul className="mt-2 max-h-56 space-y-1 overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-2">
              {results.map((item) => (
                <li key={item.name}>
                  <button
                    className="w-full rounded px-2 py-1 text-left text-xs hover:bg-slate-800"
                    onClick={() => addPackage(item.name)}
                    type="button"
                  >
                    <span className="font-mono text-emerald-300">{item.name}</span>
                    <span className="ml-2 text-slate-500">{item.description.slice(0, 80)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {error && <p className="rounded-lg border border-rose-900 bg-rose-950/40 p-3 text-sm text-rose-200">{error}</p>}
        {issues.length > 0 && (
          <ul className="rounded-lg border border-amber-900 bg-amber-950/30 p-3 text-sm text-amber-200">
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        )}
        {conflicts.length > 0 && (
          <ul className="rounded-lg border border-rose-900 bg-rose-950/40 p-3 text-sm text-rose-200">
            {conflicts.map((conflict) => (
              <li key={conflict.names.join(",")}>{conflict.message}</li>
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

      <aside className="space-y-4">
        <h2 className="font-medium">计划预览</h2>
        {!plan && <p className="text-sm text-slate-500">填写左侧表单并生成计划后，这里会显示解析后的包列表与生成文件。</p>}
        {plan && (
          <>
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm">
              <p className="text-xs uppercase tracking-wider text-slate-500">预计产物</p>
              <p className="mt-1 break-all font-mono text-emerald-300">{plan.artifactName}</p>
              <p className="mt-3 text-xs text-slate-500">设备 · 格式</p>
              <p className="text-slate-200">
                {plan.profileTitle} · {plan.imageType}
              </p>
              <p className="mt-3 text-xs text-slate-500">直接选择（{selectedEntries.length}）</p>
              <p className="text-slate-300">{selectedEntries.map((entry) => entry.name).join(", ") || "（无）"}</p>
              {unknownSelected.length > 0 && (
                <p className="mt-1 text-xs text-amber-300">
                  目录中未找到：{unknownSelected.map((entry) => entry.name).join(", ")}（构建时可能失败）
                </p>
              )}
              <p className="mt-3 text-xs text-slate-500">自动依赖（{dependencyEntries.length}）</p>
              <p className="text-slate-400">
                {dependencyEntries.slice(0, 30).map((entry) => entry.name).join(", ")}
                {dependencyEntries.length > 30 ? ` … +${dependencyEntries.length - 30}` : ""}
              </p>
            </div>

            {plan.missingDependencies.length > 0 && (
              <p className="rounded-lg border border-amber-900 bg-amber-950/30 p-3 text-xs text-amber-200">
                目录中缺少依赖：{plan.missingDependencies.join(", ")}（构建时可能失败）
              </p>
            )}

            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <p className="text-xs uppercase tracking-wider text-slate-500">生成文件</p>
              {plan.files.map((file) => (
                <div className="mt-2" key={file.path}>
                  <p className="font-mono text-xs text-emerald-300">
                    {file.path} · 0{file.mode.toString(8)}
                  </p>
                  <pre className="mt-1 max-h-64 overflow-auto rounded bg-slate-950 p-2 text-xs text-slate-300">{file.content}</pre>
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <p className="text-xs uppercase tracking-wider text-slate-500">ImageBuilder 命令</p>
              <pre className="mt-1 overflow-auto rounded bg-slate-950 p-2 text-xs text-slate-300">{plan.imageBuilderCommand}</pre>
            </div>

            <button
              className="w-full rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-emerald-950 disabled:opacity-50"
              disabled={dispatching || plan.conflicts.length > 0}
              onClick={dispatchBuild}
              type="button"
            >
              {dispatching ? "派发中…" : "开始构建"}
            </button>
          </>
        )}
      </aside>
    </div>
  );
}
