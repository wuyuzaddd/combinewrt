"use client";

import type { BasePresetOption, ModeOption } from "@/lib/build/ui-types";
import type { BuildEngine } from "@/lib/domain/types";
import type { BasePresetId } from "@/lib/domain/types";
import { modeBlockingReasons, type ModeFeatureContext } from "@/lib/build/mode-ui";

const LAYER_LABELS: Record<string, string> = {
  "file/board": "文件 / 板级",
  "package/kernel": "软件包 / 内核模块",
  "kernel/config": "内核配置",
};

const LAYER_HINTS: Record<string, string> = {
  "file/board": "生成 uci-defaults / 网络与品牌文件，不改变内核。",
  "package/kernel": "安装软件包与 kmod，不写任意脚本。",
  "kernel/config": "需要源码构建引擎，会合并内核配置片段。",
};

interface Props {
  title?: string;
  modes: ModeOption[];
  selected: string[];
  basePresets: BasePresetOption[];
  basePreset: BasePresetId;
  engine: BuildEngine;
  featureContext: Omit<ModeFeatureContext, "engine">;
  onChangePreset: (preset: BasePresetId) => void;
  onToggle: (modeId: string) => void;
}

export function ModePicker({
  modes,
  selected,
  basePresets,
  basePreset,
  engine,
  featureContext,
  onChangePreset,
  onToggle,
}: Props) {
  const layers = ["file/board", "package/kernel", "kernel/config"] as const;
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
      <h2 className="font-medium">模式（base preset + overlays）</h2>
      <p className="mt-1 text-xs text-slate-500">
        一个 base preset 加若干 overlay；requires/conflicts 在提交前即显示，服务端仍会以可读 409 复核。
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {basePresets.map((preset) => (
          <label
            className={`cursor-pointer rounded-lg border p-3 text-sm ${
              basePreset === preset.id
                ? "border-emerald-500 bg-emerald-950/40 text-emerald-200"
                : "border-slate-700 bg-slate-950 text-slate-300"
            }`}
            key={preset.id}
          >
            <input
              checked={basePreset === preset.id}
              className="sr-only"
              name="basePreset"
              onChange={() => onChangePreset(preset.id)}
              type="radio"
            />
            <span className="block font-medium">{preset.title}</span>
            <span className="mt-1 block text-[11px] text-slate-500">
              {preset.features.length > 0 ? `提供 ${preset.features.join(" · ")}` : "无网络预设"}
            </span>
          </label>
        ))}
      </div>

      {layers.map((layer) => {
        const entries = modes.filter((mode) => mode.layer === layer);
        if (entries.length === 0) return null;
        return (
          <div className="mt-4" key={layer}>
            <div className="flex flex-wrap items-baseline gap-2">
              <h3 className="text-sm font-medium">{LAYER_LABELS[layer]}</h3>
              <span className="text-[11px] text-slate-500">{LAYER_HINTS[layer]}</span>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {entries.map((mode) => {
                const context = { ...featureContext, engine };
                const reasons = modeBlockingReasons(mode, context, modes);
                const isSelected = selected.includes(mode.id);
                const disabled = !mode.offered || (!isSelected && reasons.length > 0);
                return (
                  <label
                    className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-xs ${
                      isSelected
                        ? "border-emerald-500 bg-emerald-950/40 text-emerald-200"
                        : disabled
                          ? "cursor-not-allowed border-slate-800 bg-slate-950/40 text-slate-600"
                          : "border-slate-700 bg-slate-950 text-slate-300 hover:border-emerald-600"
                    }`}
                    key={mode.id}
                    title={reasons.join("；") || mode.description || undefined}
                  >
                    <input
                      checked={isSelected}
                      className="mt-0.5"
                      disabled={disabled}
                      onChange={() => onToggle(mode.id)}
                      type="checkbox"
                    />
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-1.5 font-medium">
                        {mode.title}
                        {mode.experimental ? (
                          <span className="rounded-full border border-amber-800 px-1.5 py-0.5 text-[10px] text-amber-300">
                            实验
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block font-mono text-[10px] text-slate-500">{mode.id}</span>
                      {mode.description ? (
                        <span className="mt-1 block text-[11px] text-slate-500">{mode.description}</span>
                      ) : null}
                      {reasons.length > 0 ? (
                        <span className={`mt-1 block text-[11px] ${isSelected ? "text-rose-300" : "text-amber-400"}`}>
                          {reasons.join("；")}
                        </span>
                      ) : null}
                      {mode.packages.length > 0 ? (
                        <span className="mt-1 block break-all text-[10px] text-slate-500">
                          包：{mode.packages.join(", ")}
                        </span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
    </section>
  );
}
