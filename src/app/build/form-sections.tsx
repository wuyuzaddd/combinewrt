"use client";

import type { ReactNode } from "react";
import type { BuildUiOptions } from "@/lib/build/ui-types";
import type { ModeFeatureContext } from "@/lib/build/mode-ui";
import type { BasePresetId } from "@/lib/domain/types";
import type { NetworkInput } from "@/lib/build/types";
import type { BuildFormState, ReleaseOption } from "./form-model";
import { filterTargets } from "@/lib/build/target-filter";
import { ModePicker } from "./mode-picker";
import { NetworkSections } from "./network-sections";
import { SourceWatchPanel, type SourceWatchSummary } from "./source-watch-panel";

const inputClass =
  "mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500";

export interface FormSectionProps {
  ui: BuildUiOptions;
  form: BuildFormState;
  releases: ReleaseOption[];
  password: string;
  onPassword: (value: string) => void;
  targetQuery: string;
  onTargetQuery: (value: string) => void;
  capability: string;
  onCapability: (value: string) => void;
  onTargetProfile: (targetId: string, profileId: string) => void;
  update: <K extends keyof BuildFormState>(key: K, value: BuildFormState[K]) => void;
  patch: (patch: Partial<BuildFormState>) => void;
  picker: ReactNode;
}

export interface AdvancedSectionProps extends FormSectionProps {
  modeContext: Omit<ModeFeatureContext, "engine">;
  sourceWatch: SourceWatchSummary;
  fromBuildId: string | null;
}

function activeProfile(ui: BuildUiOptions, form: BuildFormState) {
  return ui.targets.find((target) => target.id === form.targetId)?.profiles.find(
    (profile) => profile.id === form.profileId,
  );
}

function capabilitiesOf(ui: BuildUiOptions): string[] {
  const set = new Set<string>();
  for (const target of ui.targets) for (const profile of target.profiles) for (const c of profile.capabilities) set.add(c);
  return [...set].sort();
}

function TargetSection({ ui, form, releases, targetQuery, onTargetQuery, capability, onCapability, onTargetProfile, patch }: FormSectionProps) {
  const matches = filterTargets(ui.targets, { query: targetQuery, capability });
  const choices = matches.flatMap((target) =>
    target.profiles.map((profile) => ({
      targetId: target.id,
      targetTitle: target.title,
      profile,
    })),
  );
  const current = activeProfile(ui, form);
  if (current && !choices.some((choice) => choice.targetId === form.targetId && choice.profile.id === form.profileId)) {
    choices.unshift({
      targetId: form.targetId,
      targetTitle: ui.targets.find((target) => target.id === form.targetId)?.title ?? form.targetId,
      profile: current,
    });
  }
  const value = `${form.targetId}::${form.profileId}`;
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-medium">目标与设备</h2>
        <span className="text-xs text-slate-500">能力由 registry 声明，UI 不猜测</span>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm text-slate-300">
          搜索目标 / 设备 / 能力
          <input
            className={inputClass}
            onChange={(event) => onTargetQuery(event.target.value)}
            placeholder="例如 x86、generic、qcow2"
            value={targetQuery}
          />
        </label>
        <label className="block text-sm text-slate-300">
          能力过滤
          <select className={inputClass} onChange={(event) => onCapability(event.target.value)} value={capability}>
            <option value="">全部能力</option>
            {capabilitiesOf(ui).map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm text-slate-300">
          目标 / Profile
          <select
            className={inputClass}
            onChange={(event) => {
              const [targetId, profileId] = event.target.value.split("::");
              onTargetProfile(targetId, profileId);
            }}
            value={value}
          >
            {choices.map((choice) => (
              <option
                disabled={!choice.profile.buildable}
                key={`${choice.targetId}::${choice.profile.id}`}
                value={`${choice.targetId}::${choice.profile.id}`}
              >
                {choice.targetTitle} · {choice.profile.title}
                {choice.profile.buildable ? "" : "（占位，不可构建）"}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm text-slate-300">
          Release（仅 release 通道）
          <select
            className={inputClass}
            onChange={(event) => patch({ release: event.target.value })}
            value={form.release}
          >
            {releases.map((release) => (
              <option disabled={!release.snapshotAvailable} key={release.version} value={release.version}>
                {release.version}
                {release.channel === "snapshot" ? "（实验 · 滚动通道）" : ""}
                {release.active ? "（当前）" : ""}
                {release.snapshotAvailable ? "" : "（无目录快照）"}
              </option>
            ))}
          </select>
        </label>
      </div>

      {current ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
          <span className="text-slate-500">能力：</span>
          {current.capabilities.map((item) => (
            <span className="rounded-full border border-slate-700 px-2 py-0.5 text-slate-300" key={item}>
              {item}
            </span>
          ))}
          {!current.buildable ? (
            <span className="rounded-full border border-amber-800 px-2 py-0.5 text-amber-300">
              {current.disabledReason}
            </span>
          ) : null}
        </div>
      ) : null}
      <p className="mt-2 text-[11px] text-slate-500">
        不可用变体在下方禁用并给出原因；服务端仍会再校验一次（409 双保险）。
      </p>
    </section>
  );
}

function VariantCards({ ui, form, update }: Pick<FormSectionProps, "ui" | "form" | "update">) {
  const profile = activeProfile(ui, form);
  const variants = profile?.variants ?? [];
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">镜像变体</h2>
        <span className="text-xs text-slate-500">boot × 文件系统 × 产物</span>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-4">
        {variants.map((variant) => {
          const selected =
            form.variant.boot === variant.boot &&
            form.variant.filesystem === variant.filesystem &&
            form.variant.artifact === variant.artifact;
          return (
            <label
              className={`cursor-pointer rounded-lg border p-2.5 text-xs ${
                selected
                  ? "border-emerald-500 bg-emerald-950/40 text-emerald-200"
                  : variant.supported
                    ? "border-slate-700 bg-slate-950 text-slate-300 hover:border-emerald-600"
                    : "cursor-not-allowed border-slate-800 bg-slate-950/40 text-slate-600"
              }`}
              key={variant.key}
              title={variant.disabledReason ?? variant.label}
            >
              <input
                checked={selected}
                className="sr-only"
                disabled={!variant.supported}
                name="variant"
                onChange={() =>
                  update("variant", {
                    boot: variant.boot,
                    filesystem: variant.filesystem,
                    artifact: variant.artifact,
                  })
                }
                type="radio"
              />
              <span className="block font-medium">{variant.label}</span>
              {variant.experimental ? (
                <span className="mt-1 inline-block rounded-full border border-amber-800 px-1.5 py-0.5 text-[10px] text-amber-300">
                  实验
                </span>
              ) : null}
              {!variant.supported ? (
                <span className="mt-1 block text-[10px] leading-tight text-amber-400">
                  {variant.disabledReason}
                </span>
              ) : null}
            </label>
          );
        })}
      </div>
    </div>
  );
}

function BasePresetCards({ ui, form, patch }: Pick<FormSectionProps, "ui" | "form" | "patch">) {
  return (
    <div>
      <h2 className="font-medium">基础 preset</h2>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        {ui.basePresets.map((preset) => (
          <label
            className={`cursor-pointer rounded-lg border p-3 text-sm ${
              form.basePreset === preset.id
                ? "border-emerald-500 bg-emerald-950/40 text-emerald-200"
                : "border-slate-700 bg-slate-950 text-slate-300"
            }`}
            key={preset.id}
          >
            <input
              checked={form.basePreset === preset.id}
              className="sr-only"
              name="basePreset"
              onChange={() => patch({ basePreset: preset.id as BasePresetId })}
              type="radio"
            />
            <span className="block font-medium">{preset.title}</span>
            <span className="mt-1 block text-[11px] text-slate-500">
              {preset.features.length > 0 ? `提供 ${preset.features.join(" · ")}` : "无网络预设"}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

function SystemSettings({
  form,
  releases,
  password,
  onPassword,
  update,
  patch,
}: Pick<FormSectionProps, "form" | "releases" | "password" | "onPassword" | "update" | "patch">) {
  // Ticket 11: a snapshot base version is experimental, so the public option is
  // not selectable; the planner forces private visibility regardless.
  const selectedSnapshot = releases.find((release) => release.version === form.release)?.channel === "snapshot";
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
      <h2 className="font-medium">系统设置</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block text-sm text-slate-300">
          Hostname
          <input className={inputClass} onChange={(event) => update("hostname", event.target.value)} value={form.hostname} />
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
          <input className={inputClass} onChange={(event) => update("netmask", event.target.value)} value={form.netmask} />
        </label>
      </div>
      <label className="mt-4 block text-sm text-slate-300">
        Root 密码
        <input
          autoComplete="new-password"
          className={inputClass}
          onChange={(event) => onPassword(event.target.value)}
          placeholder="8–128 字符，不会保存到浏览器"
          type="password"
          value={password}
        />
      </label>
      <fieldset className="mt-4">
        <legend className="text-sm text-slate-300">镜像用途</legend>
        {selectedSnapshot ? (
          <p className="mt-1 text-xs text-amber-300">
            所选基线是 snapshot 通道（实验/滚动），计划会被强制为自用（私有）。
          </p>
        ) : null}
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {(
            [
              { value: "private", title: "自用", hint: "允许专有/无许可证包，仅用于自己的设备" },
              { value: "public", title: "公开分发", hint: "拒绝专有/无许可证包，并在源码清单中注明" },
            ] as const
          ).map((option) => (
            <label
              className={`rounded-lg border p-3 text-sm ${
                form.visibility === option.value
                  ? "border-emerald-500 bg-emerald-950/40 text-emerald-200"
                  : "border-slate-700 bg-slate-950 text-slate-300"
              } ${
                option.value === "public" && selectedSnapshot
                  ? "cursor-not-allowed opacity-50"
                  : "cursor-pointer"
              }`}
              key={option.value}
            >
              <input
                checked={form.visibility === option.value}
                className="sr-only"
                disabled={option.value === "public" && selectedSnapshot}
                name="visibility"
                onChange={() => patch({ visibility: option.value })}
                type="radio"
              />
              <span className="block font-medium">{option.title}</span>
              <span className="mt-1 block text-xs text-slate-400">{option.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </section>
  );
}

export function SimpleForm(props: FormSectionProps) {
  const { ui, form, update, patch, picker } = props;
  return (
    <div className="space-y-6">
      <TargetSection {...props} />
      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
        <VariantCards ui={ui} form={form} update={update} />
        <div className="mt-5">
          <BasePresetCards ui={ui} form={form} patch={patch} />
        </div>
      </section>
      {picker}
      <SystemSettings {...props} />
    </div>
  );
}

export function AdvancedForm(props: AdvancedSectionProps) {
  const { ui, form, update, patch, picker, modeContext, sourceWatch, fromBuildId } = props;
  const profile = activeProfile(ui, form);
  const kernel = profile?.kernelLines.find((line) => line.id === form.kernelLine);
  return (
    <div className="space-y-6">
      <TargetSection {...props} />

      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
        <h2 className="font-medium">内核线与源码引擎</h2>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {(profile?.kernelLines ?? []).map((line) => (
            <label
              className={`cursor-pointer rounded-lg border p-3 text-sm ${
                form.kernelLine === line.id
                  ? "border-emerald-500 bg-emerald-950/40 text-emerald-200"
                  : line.offered
                    ? "border-slate-700 bg-slate-950 text-slate-300"
                    : "cursor-not-allowed border-slate-800 bg-slate-950/40 text-slate-600"
              }`}
              key={line.id}
              title={line.disabledReason ?? undefined}
            >
              <input
                checked={form.kernelLine === line.id}
                className="sr-only"
                disabled={!line.offered}
                name="kernelLine"
                onChange={() => patch({ kernelLine: line.id })}
                type="radio"
              />
              <span className="block font-medium">
                {line.id} · {line.engine === "source" ? "源码构建" : "ImageBuilder"}
                {line.experimental ? " · 实验" : ""}
              </span>
              {line.disabledReason ? (
                <span className="mt-1 block text-[11px] text-amber-400">{line.disabledReason}</span>
              ) : null}
            </label>
          ))}
        </div>
        {kernel?.engine === "source" ? (
          <p className="mt-2 text-[11px] text-amber-300">
            源码构建耗时更长；kernel/config 模式只在源码引擎可用。
          </p>
        ) : null}

        <div className="mt-5">
          <VariantCards ui={ui} form={form} update={update} />
        </div>

        {profile && form.variant.artifact !== "rootfs" ? (
          <label className="mt-4 block text-sm text-slate-300">
            Overlay 大小（MB）
            <input
              className={inputClass}
              max={profile.overlay.maxMb}
              min={profile.overlay.minMb}
              onChange={(event) => patch({ overlaySizeMb: Number(event.target.value) || profile.overlay.defaultMb })}
              step={profile.overlay.stepMb}
              type="number"
              value={form.overlaySizeMb}
            />
            <span className="mt-1 block text-[11px] text-slate-500">
              允许 {profile.overlay.minMb}–{profile.overlay.maxMb} MB，步进 {profile.overlay.stepMb} MB；默认{" "}
              {profile.overlay.defaultMb} MB。
            </span>
          </label>
        ) : (
          <p className="mt-4 text-xs text-slate-500">rootfs tar 不使用 overlay 大小。</p>
        )}
      </section>

      <ModePicker
        basePresets={ui.basePresets}
        basePreset={form.basePreset}
        engine={kernel?.engine ?? "imagebuilder"}
        featureContext={modeContext}
        modes={profile?.modes ?? []}
        onChangePreset={(preset) => patch({ basePreset: preset })}
        onToggle={(modeId) =>
          patch({
            modes: form.modes.includes(modeId)
              ? form.modes.filter((id) => id !== modeId)
              : [...form.modes, modeId],
          })
        }
        selected={form.modes}
      />

      <NetworkSectionBridge network={form.network} patch={patch} selectedModes={form.modes} />

      {picker}

      <SourceWatchPanel fromBuildId={fromBuildId} sourceWatch={sourceWatch} />

      <SystemSettings {...props} />
    </div>
  );
}

function NetworkSectionBridge({
  network,
  selectedModes,
  patch,
}: {
  network: NetworkInput;
  selectedModes: string[];
  patch: (patch: Partial<BuildFormState>) => void;
}) {
  return (
    <NetworkSections
      network={network}
      onChange={(next) => patch({ network: next })}
      selectedModes={selectedModes}
    />
  );
}
