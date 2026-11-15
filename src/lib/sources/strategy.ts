import type { AcquisitionStrategy, SourceRegistry, SourceRegistryEntry } from "./types";

export interface StrategyRequest {
  target: string;
  kernelLine: string;
  /** Kernel ABI (vermagic) currently pinned by the catalog; compared with the record's `abi`. */
  abi?: string | null;
}

export interface StrategyDecision {
  requestedStrategy: AcquisitionStrategy;
  effectiveStrategy: AcquisitionStrategy;
  fallbackReason?: string;
}

function prebuiltUnavailable(record: SourceRegistryEntry, request: StrategyRequest): string | null {
  if (!record.pin) return "no prebuilt pin is registered";
  if (record.targets && !record.targets.includes(request.target)) {
    return `target ${request.target} is outside the registered range (${record.targets.join(", ")})`;
  }
  if (record.kernelLines && !record.kernelLines.includes(request.kernelLine)) {
    return `kernel line ${request.kernelLine} is outside the registered range (${record.kernelLines.join(", ")})`;
  }
  if (record.abi && request.abi && record.abi !== request.abi) {
    return `kernel ABI mismatch (${record.abi} != ${request.abi})`;
  }
  return null;
}

/**
 * Turn a registry record into the strategy a plan entry records. A missing
 * record keeps the V1 behaviour: the catalog pin is prebuilt-valid.
 */
export function decideStrategy(
  record: SourceRegistryEntry | null,
  request: StrategyRequest,
): StrategyDecision {
  if (!record) {
    return { requestedStrategy: "prebuilt", effectiveStrategy: "prebuilt" };
  }

  if (record.strategy === "blocked") {
    return {
      requestedStrategy: "blocked",
      effectiveStrategy: "blocked",
      fallbackReason: "the source registry marks this package as blocked",
    };
  }

  if (record.strategy === "rebuild") {
    if (record.recipe) {
      return { requestedStrategy: "rebuild", effectiveStrategy: "rebuild" };
    }
    return {
      requestedStrategy: "rebuild",
      effectiveStrategy: "blocked",
      fallbackReason: "no source recipe is registered",
    };
  }

  const unavailable = prebuiltUnavailable(record, request);
  if (!unavailable) {
    return { requestedStrategy: "prebuilt", effectiveStrategy: "prebuilt" };
  }
  if (record.recipe) {
    return {
      requestedStrategy: "prebuilt",
      effectiveStrategy: "rebuild",
      fallbackReason: `prebuilt unavailable (${unavailable}); rebuilding from ${record.recipe}`,
    };
  }
  return {
    requestedStrategy: "prebuilt",
    effectiveStrategy: "blocked",
    fallbackReason: `prebuilt unavailable (${unavailable}); no source recipe is registered`,
  };
}

export function sourceOf(
  record: SourceRegistryEntry | null,
  fallback: string | null,
): string {
  return record?.source ?? fallback ?? "unknown";
}

export type { SourceRegistry };
