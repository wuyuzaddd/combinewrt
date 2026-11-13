import type { SourcePins } from "../catalog/types";
import { EMPTY_SOURCE_PINS, KERNEL_VERMAGIC_PIN } from "../catalog/types";
import { parsePackageRef } from "./refs";
import type {
  BuildConflict,
  BuildFormInput,
  BuildPlan,
  DownloadEntry,
  PackageLookup,
  PackageLookupAll,
  PackagePin,
  RequestedPackage,
} from "./types";

export interface CompositionContext {
  sourcePins?: SourcePins;
  lookup: PackageLookup;
  lookupAll?: PackageLookupAll;
}

export function collectRequests(form: BuildFormInput, conflicts: BuildConflict[]): RequestedPackage[] {
  const requests: RequestedPackage[] = [];
  for (const raw of form.packages) {
    const request = parsePackageRef(raw);
    if (!request) {
      conflicts.push({ names: [raw], message: `包名格式无效：${raw}` });
      continue;
    }
    requests.push(request);
  }
  return requests;
}

export function findSourceConflicts(
  requests: RequestedPackage[],
  entries: BuildPlan["resolved"],
  context: CompositionContext,
  packagePins: PackagePin[],
): BuildConflict[] {
  const conflicts: BuildConflict[] = [];
  const pins = context.sourcePins ?? EMPTY_SOURCE_PINS;
  const byName = new Map(entries.map((entry) => [entry.name, entry]));

  if (pins.kernel && entries.some((entry) => entry.name.startsWith("kmod-"))) {
    const actual = `${pins.kernel.version}-${pins.kernel.release}-${pins.kernel.vermagic}`;
    if (actual !== KERNEL_VERMAGIC_PIN) {
      conflicts.push({
        names: ["kmods"],
        message: `kmod vermagic 与固定内核不一致：${actual} != ${KERNEL_VERMAGIC_PIN}`,
      });
    }
  }

  const requestedSources = new Map<string, Set<string>>();
  for (const request of requests) {
    let resolvedSource: string | null = null;
    if (request.source) {
      const candidates = context.lookupAll?.(request.name) ?? [];
      const hit = candidates.find((candidate) => candidate.source === request.source);
      if (!hit) {
        const available = candidates.map((candidate) => candidate.source).join(", ");
        conflicts.push({
          names: [request.name],
          message: available
            ? `来源 ${request.source} 未提供包 ${request.name}；可用来源：${available}`
            : `来源 ${request.source} 未提供包 ${request.name}`,
        });
      } else {
        resolvedSource = request.source;
        const preferred = context.lookup(request.name);
        if (preferred && preferred.source !== request.source) {
          conflicts.push({
            names: [request.name],
            message: `包 ${request.name} 已由更高优先级来源 ${preferred.source} 提供，不允许改用 ${request.source}`,
          });
        }
      }
    } else {
      resolvedSource = context.lookup(request.name)?.source ?? null;
    }
    if (!resolvedSource) continue;
    const set = requestedSources.get(request.name) ?? new Set<string>();
    set.add(resolvedSource);
    requestedSources.set(request.name, set);
  }

  for (const [name, sources] of requestedSources) {
    if (sources.size > 1) {
      conflicts.push({
        names: [name],
        message: `包 ${name} 同时来自多个来源（${[...sources].join(", ")}）；一次构建只能固定一个来源`,
      });
    }
  }

  for (const entry of entries) {
    if (entry.name.startsWith("kmod-") && entry.packageSource && entry.packageSource !== "official") {
      conflicts.push({
        names: [entry.name],
        message: `kmod 只允许来自官方来源：${entry.name} 当前来自 ${entry.packageSource}`,
      });
    }

    if (!entry.packageSource) continue;
    if (entry.packageSource === "official") {
      if (entry.sourcePin && entry.feed) {
        const expected = pins.official[entry.feed];
        if (!expected) {
          conflicts.push({
            names: [entry.name],
            message: `快照未记录官方 feed ${entry.feed} 的 pin，无法验证 ${entry.name}`,
          });
        } else if (expected !== entry.sourcePin) {
          conflicts.push({
            names: [entry.name],
            message: `包 ${entry.name} 的官方 pin 与快照不一致：${entry.sourcePin} != ${expected}`,
          });
        }
      }
    } else if (entry.packageSource === "dllkids") {
      if (!pins.dllkids) {
        conflicts.push({ names: [entry.name], message: `快照未记录 dllkids 索引 pin，无法验证 ${entry.name}` });
      } else if (entry.sourcePin !== pins.dllkids) {
        conflicts.push({
          names: [entry.name],
          message: `包 ${entry.name} 的 dllkids pin 与快照不一致：${entry.sourcePin} != ${pins.dllkids}`,
        });
      }
    } else {
      const supplement = pins.supplement;
      if (!supplement || (!supplement.commit && !supplement.fingerprint)) {
        conflicts.push({ names: [entry.name], message: `快照未记录自有源 pin，无法验证 ${entry.name}` });
      } else if (
        entry.sourcePin !== supplement.indexSha256 &&
        entry.sourcePin !== supplement.commit &&
        entry.sourcePin !== supplement.fingerprint
      ) {
        conflicts.push({
          names: [entry.name],
          message: `包 ${entry.name} 的自有源 pin 与快照不一致：${entry.sourcePin}`,
        });
      }
    }
  }

  for (const pin of packagePins) {
    const entry = byName.get(pin.name);
    if (!entry) {
      conflicts.push({ names: [pin.name], message: `pin 指向的包 ${pin.name} 不在计划中` });
      continue;
    }
    if (pin.source && entry.packageSource !== pin.source) {
      conflicts.push({
        names: [pin.name],
        message: `包 ${pin.name} 固定来源 ${pin.source}，但计划来源为 ${entry.packageSource ?? "未知"}`,
      });
    }
    if (pin.version && entry.version !== pin.version) {
      conflicts.push({
        names: [pin.name],
        message: `包 ${pin.name} 固定版本 ${pin.version}，但来源版本为 ${entry.version ?? "未知"}`,
      });
    }
    if (pin.sha256 && entry.sha256 !== pin.sha256) {
      conflicts.push({
        names: [pin.name],
        message: `包 ${pin.name} 的 sha256 与 pin 不一致：${entry.sha256 ?? "缺失"}`,
      });
    }
  }

  for (const request of requests) {
    const entry = byName.get(request.name);
    if (request.version && entry && entry.version !== request.version) {
      conflicts.push({
        names: [request.name],
        message: `包 ${request.name} 请求版本 ${request.version}，但来源版本为 ${entry.version ?? "未知"}`,
      });
    }
  }

  return conflicts;
}

export function buildDownloadManifest(
  entries: BuildPlan["resolved"],
  context: CompositionContext,
  conflicts: BuildConflict[],
): DownloadEntry[] {
  const downloads = new Map<string, DownloadEntry>();
  for (const entry of entries) {
    if (!entry.packageSource || entry.packageSource === "official" || !entry.version) continue;
    const candidates = context.lookupAll?.(entry.name) ?? [];
    const hit = candidates.find((candidate) => candidate.source === entry.packageSource);
    if (!hit?.sha256 || !hit.filename || !hit.downloadUrl) {
      conflicts.push({
        names: [entry.name],
        message: `非官方包 ${entry.name} 缺少可校验的下载信息（sha256/文件名/URL）`,
      });
      continue;
    }
    downloads.set(hit.filename, {
      name: entry.name,
      version: entry.version,
      source: entry.packageSource,
      sourcePin: hit.sourcePin,
      url: hit.downloadUrl,
      filename: hit.filename,
      sha256: hit.sha256,
    });
  }
  return [...downloads.values()].sort((a, b) => a.name.localeCompare(b.name));
}
