import {
  RELEASES_ROOT,
  compareVersions,
  fetchReleaseCandidate,
  latestRelease,
  parseReleaseIndex,
} from "./releases";
import type { BaseVersionStore } from "./store";
import type { BaseCheckState, BaseVersionState, SmokeState } from "./types";
import type { BuildStatus } from "../builds/types";

export interface BaseVersionServiceOptions {
  store: BaseVersionStore;
  refresh: (baseVersion: string) => Promise<{ snapshotId: number }>;
  submitSmoke: (baseVersion: string, snapshotId: number) => Promise<{ buildId: string }>;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export interface BaseVersionService {
  checkForNewRelease(): Promise<BaseCheckState>;
  bump(version: string): Promise<BaseVersionState>;
  revert(): Promise<BaseVersionState>;
  readState(): BaseVersionState;
  noteSmokeBuild(status: BuildStatus, error: string | null): void;
  waitForPipeline(): Promise<void>;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createBaseVersionService(options: BaseVersionServiceOptions): BaseVersionService {
  const { store, refresh, submitSmoke, fetchImpl = fetch, now = () => new Date() } = options;
  let pipeline: Promise<void> | null = null;

  function readState(): BaseVersionState {
    const active = store.active();
    const check = store.check();
    const candidate =
      check?.latest && (!active || compareVersions(check.latest.version, active.version) > 0)
        ? check.latest
        : null;
    return {
      active,
      previous: store.previous(),
      candidate,
      check,
      smoke: store.smoke(),
    };
  }

  async function checkForNewRelease(): Promise<BaseCheckState> {
    const checkedAt = now().toISOString();
    try {
      const response = await fetchImpl(RELEASES_ROOT);
      if (!response.ok) {
        throw new Error(`failed to fetch ImmortalWrt releases: HTTP ${response.status}`);
      }
      const releases = parseReleaseIndex(await response.text());
      const newest = latestRelease(releases);
      if (!newest) throw new Error("no stable ImmortalWrt release was found");

      const active = store.active();
      if (active && compareVersions(newest.version, active.version) <= 0) {
        const check: BaseCheckState = { checkedAt, latest: null, error: null };
        store.setCheck(check);
        return check;
      }

      const candidate = await fetchReleaseCandidate(newest.version, newest.releaseDate, fetchImpl);
      const check: BaseCheckState = { checkedAt, latest: candidate, error: null };
      store.setCheck(check);
      return check;
    } catch (error) {
      const check: BaseCheckState = { checkedAt, latest: null, error: message(error) };
      store.setCheck(check);
      return check;
    }
  }

  async function runPipeline(version: string): Promise<void> {
    const startedAt = now().toISOString();
    try {
      const refreshed = await refresh(version);
      const building: SmokeState = {
        phase: "building",
        buildId: null,
        snapshotId: refreshed.snapshotId,
        error: null,
        startedAt,
        updatedAt: now().toISOString(),
      };
      store.setSmoke(building);
      const { buildId } = await submitSmoke(version, refreshed.snapshotId);
      store.setSmoke({ ...building, buildId, updatedAt: now().toISOString() });
    } catch (error) {
      store.setSmoke({
        phase: "failed",
        buildId: null,
        snapshotId: store.smoke()?.snapshotId ?? null,
        error: message(error),
        startedAt,
        updatedAt: now().toISOString(),
      });
    }
  }

  return {
    checkForNewRelease,
    async bump(version) {
      const active = store.active();
      if (active?.version === version) throw new Error(`ImmortalWrt ${version} is already the active baseline`);

      let record = store.get(version);
      if (!record) {
        const candidate = store.check()?.latest;
        if (!candidate || candidate.version !== version) {
          throw new Error(`ImmortalWrt ${version} has not been discovered yet; check for a new release first`);
        }
        record = store.upsert({
          version: candidate.version,
          releaseDate: candidate.releaseDate,
          imageBuilderUrl: candidate.imageBuilderUrl,
          imageBuilderSha256: candidate.imageBuilderSha256,
        });
      }

      if (active) store.setPrevious(active.version);
      store.setActive(record.version);
      store.setSmoke({
        phase: "refreshing",
        buildId: null,
        snapshotId: null,
        error: null,
        startedAt: now().toISOString(),
        updatedAt: now().toISOString(),
      });

      pipeline = runPipeline(record.version);
      await Promise.resolve();
      return readState();
    },
    async revert() {
      const active = store.active();
      const previous = store.previous();
      if (!previous) throw new Error("there is no previous baseline to revert to");
      if (active) store.setPrevious(active.version);
      store.setActive(previous.version);
      store.activateLatestSnapshot(previous.version);
      store.setSmoke(null);
      return readState();
    },
    readState,
    noteSmokeBuild(status, error) {
      const smoke = store.smoke();
      if (!smoke || smoke.phase !== "building") return;
      if (status === "succeeded") {
        store.setSmoke({ ...smoke, phase: "succeeded", error: null, updatedAt: now().toISOString() });
      } else if (status === "failed" || status === "cancelled") {
        store.setSmoke({
          ...smoke,
          phase: "failed",
          error: error ?? `smoke build ${status}`,
          updatedAt: now().toISOString(),
        });
      }
    },
    async waitForPipeline() {
      if (pipeline) await pipeline;
    },
  };
}
