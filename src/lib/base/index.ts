import { randomBytes } from "node:crypto";
import { getConfig } from "../config";
import { getDatabase } from "../db";
import { validateBuildForm } from "../build/validate";
import { getBuildService } from "../builds";
import { preparePlanForForm } from "../builds/prepare";
import { createCatalogStore } from "../catalog/store";
import { refreshCatalog } from "../catalog/service";
import { createImmortalWrtSource } from "../catalog/source";
import { createBaseVersionService, type BaseVersionService } from "./service";
import { createBaseVersionStore } from "./store";
import type { BaseVersionState } from "./types";

let cached: BaseVersionService | undefined;
let checkTimer: NodeJS.Timeout | undefined;

function createService(): BaseVersionService {
  const config = getConfig();
  const db = getDatabase();
  const catalogStore = createCatalogStore(db);

  return createBaseVersionService({
    store: createBaseVersionStore(db),
    activeSnapshotId: () => catalogStore.getActiveSnapshot()?.id ?? null,
    activateSnapshot: (snapshotId) => catalogStore.activateSnapshot(snapshotId),
    async refresh(baseVersion) {
      const result = await refreshCatalog({
        source: createImmortalWrtSource({
          baseVersion,
          apkBin: config.apkBin,
          dllkids: { baseUrl: config.dllkidsFeedUrl, indexSha256: config.dllkidsIndexSha256 },
          supplement:
            config.supplementFeedCommit || config.supplementKeyFingerprint
              ? {
                  commit: config.supplementFeedCommit,
                  fingerprint: config.supplementKeyFingerprint,
                }
              : null,
        }),
        db,
      });
      catalogStore.activateSnapshot(result.snapshot.id);
      return { snapshotId: result.snapshot.id };
    },
    // A supplement package build is only triggered once the supplement source is
    // configured; its workflow belongs to the supplement-packages spec and does not
    // exist in this repository yet.
    async submitSmoke() {
      const validation = validateBuildForm({
        profile: "generic",
        imageType: "ext4-efi",
        hostname: "combinewrt-smoke",
        timezone: "UTC",
        lanIp: "192.168.1.1",
        netmask: "255.255.255.0",
        rootPassword: randomBytes(18).toString("base64url"),
        packages: [],
      });
      if (!validation.ok) throw new Error(`smoke form is invalid: ${validation.issues.join("; ")}`);

      const prepared = await preparePlanForForm(validation.value);
      if (!prepared.ok) {
        const reason =
          "error" in prepared.body ? String(prepared.body.error) : "smoke plan could not be prepared";
        throw new Error(reason);
      }
      if (prepared.plan.conflicts.length > 0) {
        throw new Error(prepared.plan.conflicts.map((conflict) => conflict.message).join("; "));
      }

      const build = await getBuildService().submit(prepared.plan);
      if (build.status === "failed") throw new Error(build.error ?? "smoke build dispatch failed");
      return { buildId: build.id };
    },
  });
}

export function getBaseVersionService(): BaseVersionService {
  cached ??= createService();
  return cached;
}

export function readBaseVersionState(): BaseVersionState {
  return getBaseVersionService().readState();
}

export async function syncBaseVersionState(): Promise<BaseVersionState> {
  const service = getBaseVersionService();
  const state = service.readState();
  if (state.smoke?.buildId && state.smoke.phase === "building") {
    try {
      const build = await getBuildService().refresh(state.smoke.buildId);
      if (build) service.noteSmokeBuild(build.status, build.error);
    } catch (error) {
      console.error("[combinewrt] smoke status refresh failed", error);
    }
    return service.readState();
  }
  return state;
}

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CHECK_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SMOKE_INTERVAL_MS = 10_000;
let smokeTimer: NodeJS.Timeout | undefined;

export function startBaseVersionMonitor(): void {
  if (smokeTimer) return;
  const run = () => {
    void syncBaseVersionState().catch((error: unknown) => {
      console.error("[combinewrt] smoke status refresh failed", error);
    });
  };
  smokeTimer = setInterval(run, SMOKE_INTERVAL_MS);
  smokeTimer.unref();
}

export function startBaseVersionCheck(): void {
  if (checkTimer) return;
  const run = () => {
    try {
      const service = getBaseVersionService();
      const check = service.readState().check;
      if (check?.checkedAt) {
        const maxAge = check.error ? 24 * 60 * 60 * 1000 : CHECK_MAX_AGE_MS;
        if (Date.now() - Date.parse(check.checkedAt) < maxAge) return;
      }
      void service.checkForNewRelease().catch((error: unknown) => {
        console.error("[combinewrt] base version check failed", error);
      });
    } catch (error) {
      console.error("[combinewrt] base version check failed", error);
    }
  };
  const first = setTimeout(run, 10_000);
  first.unref();
  checkTimer = setInterval(run, CHECK_INTERVAL_MS);
  checkTimer.unref();
}
