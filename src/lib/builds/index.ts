import { getConfig } from "../config";
import { getDatabase } from "../db";
import { createAdapter } from "./adapter";
import { createBuildService, type BuildService } from "./service";
import { createBuildStore } from "./store";

import { createReconciler, type Reconciler } from "./reconciler";

let cached: BuildService | undefined;
let reconciler: Reconciler | undefined;

export function getBuildService(): BuildService {
  cached ??= createBuildService({
    store: createBuildStore(getDatabase()),
    adapter: createAdapter(getConfig()),
    pollIntervalMs: 5_000,
  });
  return cached;
}

export function startReconciler(): void {
  if (reconciler) return;
  reconciler = createReconciler(getBuildService());
  reconciler.start();
}
