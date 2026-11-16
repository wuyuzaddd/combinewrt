/**
 * Client-safe mode evaluation (ticket 15).
 *
 * `modes.ts` is the planner: it executes with node-only imports and produces the
 * final generated files. The form needs the same requirement/conflict semantics
 * *before* it submits, so this module evaluates only the declarative tokens
 * (`engine:`, `filesystem:`, `capability:`, `mode:`, `package:`, `feature:`)
 * against the current selection. It imports nothing from `node:*`.
 */
import type { ArtifactKind, BuildEngine, FilesystemKind } from "../domain/types";
import type { ModeOption } from "./ui-types";

export interface ModeFeatureContext {
  engine: BuildEngine;
  filesystem: FilesystemKind;
  artifact: ArtifactKind;
  capabilities: readonly string[];
  basePresetFeatures: readonly string[];
  selectedModeIds: readonly string[];
  selectedPackages?: readonly string[];
}

export const REQUIREMENT_LABELS: Record<string, string> = {
  "engine:source": "源码构建引擎",
  "engine:imagebuilder": "ImageBuilder 引擎",
  "filesystem:ext4": "ext4 文件系统",
  "filesystem:squashfs": "squashfs 文件系统",
  "artifact:combined": "combined 镜像",
  "artifact:rootfs": "rootfs tar",
  "feature:dhcp-server": "LAN DHCP 服务",
  "feature:default-wan": "默认 WAN 映射",
};

/** Human label for one planner token, falling back to the raw token. */
export function requirementLabel(token: string): string {
  const known = REQUIREMENT_LABELS[token];
  if (known) return known;
  const [kind, ...rest] = token.split(":");
  const value = rest.join(":");
  switch (kind) {
    case "capability":
      return `能力 ${value}`;
    case "mode":
      return `模式 ${value}`;
    case "package":
      return `软件包 ${value}`;
    case "engine":
      return `${value} 引擎`;
    default:
      return token;
  }
}

/** The features the current selection provides, matching the planner's construction. */
export function modeFeatureSet(context: ModeFeatureContext): Set<string> {
  const features = new Set<string>(context.basePresetFeatures);
  for (const capability of context.capabilities) features.add(`capability:${capability}`);
  features.add(`engine:${context.engine}`);
  features.add(`filesystem:${context.filesystem}`);
  features.add(`artifact:${context.artifact}`);
  for (const id of context.selectedModeIds) features.add(`mode:${id}`);
  return features;
}

/**
 * Why a mode cannot be combined with the current selection. An empty array means
 * it is compatible. This mirrors `resolveModes` and is used for front-end
 * disabling; the planner remains the authority and still answers 409.
 */
export function modeBlockingReasons(
  mode: ModeOption,
  context: ModeFeatureContext,
  allModes: readonly ModeOption[],
): string[] {
  const reasons: string[] = [];
  const features = modeFeatureSet(context);

  if (!mode.offered) {
    reasons.push(mode.disabledReason ?? "该 profile 未提供此模式");
    return reasons;
  }

  for (const token of mode.requires) {
    if (!features.has(token)) {
      reasons.push(`需要${requirementLabel(token)}`);
    }
  }
  for (const group of mode.requiresAny) {
    if (!group.some((token) => features.has(token))) {
      reasons.push(`需要以下之一：${group.map(requirementLabel).join(" / ")}`);
    }
  }
  for (const token of mode.conflicts) {
    if (token.startsWith("package:")) {
      const name = token.slice("package:".length);
      if (context.selectedPackages?.includes(name)) {
        reasons.push(`与软件包 ${name} 冲突`);
      }
      continue;
    }
    if (features.has(token)) {
      reasons.push(`与${requirementLabel(token)}冲突`);
    }
  }
  if (mode.exclusiveGroup) {
    const other = allModes.find(
      (candidate) =>
        candidate.id !== mode.id &&
        candidate.exclusiveGroup === mode.exclusiveGroup &&
        context.selectedModeIds.includes(candidate.id),
    );
    if (other) {
      reasons.push(`与模式 ${other.title} 互斥（同一 ${mode.exclusiveGroup} 映射）`);
    }
  }
  return reasons;
}

/** True when the mode can be selected on top of the current selection. */
export function modeSelectable(
  mode: ModeOption,
  context: ModeFeatureContext,
  allModes: readonly ModeOption[],
): boolean {
  return modeBlockingReasons(mode, context, allModes).length === 0;
}
