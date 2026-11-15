import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { migrate, openDatabase } from "../db";
import { readSourcePin } from "../source-watch/store";
import type { FeedPublishRecord } from "./types";
import {
  createSupplementWatchService,
  type BuildRunState,
  type DispatchBuildInput,
  type SupplementWatchService,
} from "./service";
import { fingerprintRecipe, type SupplementRecipe } from "./recipe";

const COMMIT_OLD = "1".repeat(40);
const COMMIT_NEW = "2".repeat(40);
const COMMIT_NEWER = "3".repeat(40);
const INDEX_SHA = "d".repeat(64);
const KEY_FP = "f".repeat(64);

function recipe(overrides: Partial<SupplementRecipe> = {}): SupplementRecipe {
  return {
    sourceRepo: "kiddin9/op-packages",
    ref: "main",
    baseVersion: "25.12.2",
    target: "x86_64",
    packages: [
      { name: "luci-app-store", license: "Apache-2.0", publicAllowed: true },
      { name: "taskd", license: "GPL-2.0-only", publicAllowed: true },
    ],
    ...overrides,
  };
}

interface Harness {
  db: DatabaseSync;
  service: SupplementWatchService;
  dispatched: DispatchBuildInput[];
  promotions: Array<{ buildRunId: string; baseVersion: string; sourceCommit: string }>;
  runs: Map<string, BuildRunState>;
  audits: Map<string, FeedPublishRecord>;
  setCommit(commit: string): void;
  setRecipe(next: SupplementRecipe | null): void;
  failDispatch(message: string | null): void;
  advance(ms: number): void;
  seedActive(commit: string, overrides?: Record<string, unknown>): void;
  /** Let a dispatched run succeed and publish to the given channel. */
  publish(runId: string, channel: "live" | "staging", sourceCommit: string): void;
}

function feedRecord(
  channel: "live" | "staging",
  buildRunId: string,
  sourceCommit: string,
): FeedPublishRecord {
  return {
    channel,
    buildRunId,
    baseVersion: "25.12.2",
    target: "x86_64",
    sourceCommit,
    indexSha256: INDEX_SHA,
    keyFingerprint: KEY_FP,
    frozenPath: `supplement/25.12.2/x86_64/${sourceCommit}`,
    publishedAt: "2026-11-15T06:00:00.000Z",
  };
}

const PUBLISH_URL = "https://feed.test/publish.json";
const STAGING_URL = "https://feed.test/staging.json";

function harness(): Harness {
  const db = openDatabase(":memory:");
  migrate(db);
  let clock = new Date("2026-11-15T00:00:00.000Z");
  let commit = COMMIT_NEW;
  let currentRecipe: SupplementRecipe | null = recipe();
  let dispatchError: string | null = null;
  let nextRun = 5000;
  const dispatched: DispatchBuildInput[] = [];
  const promotions: Harness["promotions"] = [];
  const runs = new Map<string, BuildRunState>();
  const audits = new Map<string, FeedPublishRecord>();

  const service = createSupplementWatchService({
    db,
    sourceRepo: "kiddin9/op-packages",
    sourceRef: "main",
    baseVersion: "25.12.2",
    target: "x86_64",
    buildRepo: "wuyuzaddd/combinewrt-build",
    buildWorkflow: "packages.yml",
    keyFingerprint: KEY_FP,
    publishAuditUrl: PUBLISH_URL,
    stagingAuditUrl: STAGING_URL,
    intervalMs: 6 * 60 * 60 * 1000,
    now: () => clock,
    readRecipe: () => currentRecipe,
    observeUpstream: async () => ({ commit, observedAt: clock.toISOString() }),
    dispatchBuild: async (input) => {
      if (dispatchError) throw new Error(dispatchError);
      dispatched.push(input);
      const runId = String(nextRun++);
      runs.set(runId, { status: "queued", conclusion: null, url: `https://gh.test/runs/${runId}` });
      return { runId, url: `https://gh.test/runs/${runId}` };
    },
    readRun: async (runId) => runs.get(runId) ?? { status: "unknown", conclusion: null, url: null },
    dispatchPublish: async (input) => {
      promotions.push(input);
    },
    fetchFeedRecord: async (url) => audits.get(url) ?? null,
  });

  return {
    db,
    service,
    dispatched,
    promotions,
    runs,
    audits,
    setCommit(next) {
      commit = next;
    },
    setRecipe(next) {
      currentRecipe = next;
    },
    failDispatch(message) {
      dispatchError = message;
    },
    advance(ms) {
      clock = new Date(clock.getTime() + ms);
    },
    seedActive(activeCommit, overrides = {}) {
      db.prepare(
        `INSERT INTO source_pins (source, status, value, adopted_at, adopted_by, metadata_json)
         VALUES ('supplement', 'active', ?, '2026-11-01T00:00:00.000Z', 'operator', ?)`,
      ).run(activeCommit, JSON.stringify(activeMetadata(overrides)));
    },
    publish(runId, channel, sourceCommit) {
      runs.set(runId, { status: "completed", conclusion: "success", url: `https://gh.test/runs/${runId}` });
      const url = channel === "live" ? PUBLISH_URL : STAGING_URL;
      audits.set(url, feedRecord(channel, runId, sourceCommit));
    },
  };
}

/** Fingerprint metadata of the default recipe, as an active pin would store it. */
function activeMetadata(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const fingerprint = fingerprintRecipe(recipe());
  return {
    baseVersion: "25.12.2",
    target: "x86_64",
    ...fingerprint,
    metadataFingerprint: fingerprint.fingerprint,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("supplement watch: candidate to dispatch", () => {
  it("dispatches the build with the observed commit and an exact base_version", async () => {
    const h = harness();
    h.seedActive(COMMIT_OLD);
    const result = await h.service.check({ trigger: "schedule" });

    expect(result.status).toBe("dispatched");
    expect(result.publishMode).toBe("live");
    expect(h.dispatched).toHaveLength(1);
    expect(h.dispatched[0]).toMatchObject({
      baseVersion: "25.12.2",
      sourceCommit: COMMIT_NEW,
      publishMode: "live",
      gateReason: "metadata_unchanged",
    });

    const row = h.service.readOverview().publishes[0];
    expect(row).toMatchObject({
      sourceCommit: COMMIT_NEW,
      status: "dispatched",
      publishMode: "live",
      buildRunId: "5000",
      trigger: "schedule",
    });
    expect(readSourcePin(h.db, "supplement", "candidate")?.value).toBe(COMMIT_NEW);
  });

  it("stages a candidate whose SPDX metadata changed", async () => {
    const h = harness();
    h.seedActive(COMMIT_OLD);
    h.setRecipe(
      recipe({
        packages: [
          { name: "luci-app-store", license: "MIT", publicAllowed: true },
          { name: "taskd", license: "GPL-2.0-only", publicAllowed: true },
        ],
      }),
    );

    const result = await h.service.check({ trigger: "schedule" });
    expect(result.publishMode).toBe("staging");
    expect(result.gateReason).toBe("recipe_changed");
    expect(h.dispatched[0].publishMode).toBe("staging");
  });

  it("stages the very first publish because there is no baseline pin", async () => {
    const h = harness();
    const result = await h.service.check({ trigger: "manual" });
    expect(result.publishMode).toBe("staging");
    expect(result.gateReason).toBe("first_publish");
  });

  it("collapses a webhook and a scheduled check of the same commit into one build", async () => {
    const h = harness();
    h.seedActive(COMMIT_OLD);
    const scheduled = await h.service.check({ trigger: "schedule" });
    const webhook = await h.service.check({ trigger: "webhook", observedCommit: COMMIT_NEW });

    expect(scheduled.status).toBe("dispatched");
    expect(webhook.status).toBe("skipped");
    expect(webhook.publishId).toBe(scheduled.publishId);
    expect(h.dispatched).toHaveLength(1);
  });

  it("stages a candidate when the previous metadata differs only in publicAllowed", async () => {
    const h = harness();
    h.seedActive(COMMIT_OLD, { publicAllowed: false, metadataFingerprint: "e".repeat(64) });
    const result = await h.service.check({ trigger: "schedule" });
    expect(result.publishMode).toBe("staging");
    expect(result.gateReason).toBe("public_allowed_changed");
  });

  it("records a failed dispatch and retries the same commit on the next check", async () => {
    const h = harness();
    h.seedActive(COMMIT_OLD);
    h.failDispatch("github is unreachable");
    const failed = await h.service.check({ trigger: "schedule" });
    expect(failed.status).toBe("error");
    expect(failed.error).toContain("github is unreachable");
    const firstRow = h.service.readOverview().publishes[0];
    expect(firstRow).toMatchObject({ status: "failed", reason: "dispatch_failed" });

    h.failDispatch(null);
    const retried = await h.service.check({ trigger: "schedule" });
    expect(retried.status).toBe("dispatched");
    const overview = h.service.readOverview();
    expect(overview.publishes).toHaveLength(1);
    expect(overview.publishes[0]).toMatchObject({ id: firstRow.id, status: "dispatched", attempts: 2 });
  });

  it("rejects an upstream observation that is not a full commit id", async () => {
    const h = harness();
    h.setCommit("main");
    const result = await h.service.check({ trigger: "schedule" });
    expect(result.status).toBe("error");
    expect(result.error).toContain("40 character");
    expect(h.dispatched).toHaveLength(0);
  });
});

describe("supplement watch: reconcile", () => {
  it("auto-publishes live and adopts the pin when only the source commit changed", async () => {
    const h = harness();
    h.seedActive(COMMIT_OLD);
    const check = await h.service.check({ trigger: "schedule" });
    const runId = check.buildRunId as string;

    h.publish(runId, "live", COMMIT_NEW);
    const reconciled = await h.service.reconcile();
    expect(reconciled.updated).toEqual(["published"]);

    const active = readSourcePin(h.db, "supplement", "active");
    expect(active?.value).toBe(COMMIT_NEW);
    expect(active?.adoptedBy).toBe("auto-publish");
    expect(active?.metadata).toMatchObject({
      indexSha256: INDEX_SHA,
      keyFingerprint: KEY_FP,
      buildRunId: runId,
      frozenPath: `supplement/25.12.2/x86_64/${COMMIT_NEW}`,
      baseVersion: "25.12.2",
      target: "x86_64",
    });
    expect(readSourcePin(h.db, "supplement", "candidate")).toBeNull();

    const overview = h.service.readOverview();
    expect(overview.publishes[0]).toMatchObject({
      status: "published",
      indexSha256: INDEX_SHA,
      keyFingerprint: KEY_FP,
    });
  });

  it("refuses a live audit record signed by an unexpected key", async () => {
    const h = harness();
    h.seedActive(COMMIT_OLD);
    const check = await h.service.check({ trigger: "schedule" });
    const runId = check.buildRunId as string;

    h.runs.set(runId, { status: "completed", conclusion: "success", url: `https://gh.test/runs/${runId}` });
    h.audits.set(PUBLISH_URL, { ...feedRecord("live", runId, COMMIT_NEW), keyFingerprint: "9".repeat(64) });

    const reconciled = await h.service.reconcile();
    expect(reconciled.updated).toEqual(["failed"]);
    expect(readSourcePin(h.db, "supplement", "active")?.value).toBe(COMMIT_OLD);
    expect(h.service.readOverview().publishes[0]).toMatchObject({
      status: "failed",
      reason: "key_fingerprint_mismatch",
    });
  });

  it("keeps a changed-metadata build in staging and leaves the live pin alone", async () => {
    const h = harness();
    h.seedActive(COMMIT_OLD);
    h.setRecipe(
      recipe({
        packages: [{ name: "taskd", license: "GPL-2.0-only", publicAllowed: true }],
      }),
    );
    const check = await h.service.check({ trigger: "schedule" });
    expect(check.publishMode).toBe("staging");

    h.publish(check.buildRunId as string, "staging", COMMIT_NEW);
    const reconciled = await h.service.reconcile();
    expect(reconciled.updated).toEqual(["staged"]);

    expect(readSourcePin(h.db, "supplement", "active")?.value).toBe(COMMIT_OLD);
    const row = h.service.readOverview().publishes[0];
    expect(row.status).toBe("staged");
    expect(row.reason).toBe("recipe_changed");
    expect(row.frozenPath).toBe(`supplement/25.12.2/x86_64/${COMMIT_NEW}`);
    expect(row.publishMode).toBe("staging");
  });

  it("keeps the failed build out of the live feed and leaves the candidate for review", async () => {
    const h = harness();
    h.seedActive(COMMIT_OLD);
    const check = await h.service.check({ trigger: "schedule" });
    h.runs.set(check.buildRunId as string, {
      status: "completed",
      conclusion: "failure",
      url: "https://gh.test/runs/5000",
    });

    const reconciled = await h.service.reconcile();
    expect(reconciled.updated).toEqual(["failed"]);
    expect(readSourcePin(h.db, "supplement", "active")?.value).toBe(COMMIT_OLD);
    expect(readSourcePin(h.db, "supplement", "candidate")?.value).toBe(COMMIT_NEW);
    expect(h.service.readOverview().publishes[0]).toMatchObject({
      status: "failed",
      reason: "build_failure",
    });
  });

  it("moves a dispatched run to running while the build is still queued", async () => {
    const h = harness();
    h.seedActive(COMMIT_OLD);
    const check = await h.service.check({ trigger: "schedule" });
    h.runs.set(check.buildRunId as string, { status: "in_progress", conclusion: null, url: null });

    const reconciled = await h.service.reconcile();
    expect(reconciled.updated).toEqual([]);
    expect(h.service.readOverview().publishes[0].status).toBe("running");
  });

  it("marks publish_pending when a successful build never reaches the feed", async () => {
    const h = harness();
    h.seedActive(COMMIT_OLD);
    const check = await h.service.check({ trigger: "schedule" });
    h.runs.set(check.buildRunId as string, { status: "completed", conclusion: "success", url: null });

    for (let attempt = 0; attempt < 6; attempt += 1) await h.service.reconcile();
    const row = h.service.readOverview().publishes[0];
    expect(row.status).toBe("publish_pending");
    expect(row.reason).toBe("publish_audit_pending");
    // 1 dispatch attempt + 6 reconciliation polls.
    expect(row.attempts).toBe(7);
  });
});

describe("supplement watch: promotion", () => {
  async function staged(h: Harness) {
    h.seedActive(COMMIT_OLD);
    h.setRecipe(
      recipe({ packages: [{ name: "taskd", license: "GPL-2.0-only", publicAllowed: true }] }),
    );
    const check = await h.service.check({ trigger: "schedule" });
    h.publish(check.buildRunId as string, "staging", COMMIT_NEW);
    await h.service.reconcile();
    return h.service.readOverview().publishes[0];
  }

  it("promotes a staged run by re-dispatching it to the live channel", async () => {
    const h = harness();
    const row = await staged(h);
    expect(row.status).toBe("staged");

    const result = await h.service.promote(row.id, { promotedBy: "admin" });
    expect(result.ok).toBe(true);
    expect(h.promotions).toEqual([
      { buildRunId: row.buildRunId, baseVersion: "25.12.2", sourceCommit: COMMIT_NEW },
    ]);

    const promoted = h.service.readOverview().publishes[0];
    expect(promoted).toMatchObject({
      status: "dispatched",
      publishMode: "live",
      reason: "promoted_from_staging",
      promotedBy: "admin",
    });

    h.publish(promoted.buildRunId as string, "live", COMMIT_NEW);
    await h.service.reconcile();
    expect(readSourcePin(h.db, "supplement", "active")?.value).toBe(COMMIT_NEW);
  });

  it("refuses to promote anything that is not staged", async () => {
    const h = harness();
    h.seedActive(COMMIT_OLD);
    await h.service.check({ trigger: "schedule" });
    const row = h.service.readOverview().publishes[0];
    const result = await h.service.promote(row.id);
    expect(result.ok).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe("publish_is_dispatched");
    expect(h.promotions).toHaveLength(0);
  });

  it("reports a daily-check gate so a six-hour scheduler does not double dispatch", async () => {
    const h = harness();
    h.seedActive(COMMIT_OLD);
    const first = await h.service.runIfDue();
    expect(first.ran).toBe(true);
    const again = await h.service.runIfDue();
    expect(again.ran).toBe(false);
    h.advance(6 * 60 * 60 * 1000);
    h.setCommit(COMMIT_NEWER);
    const third = await h.service.runIfDue();
    expect(third.ran).toBe(true);
    expect(third.result?.observedCommit).toBe(COMMIT_NEWER);
    expect(h.dispatched).toHaveLength(2);
  });
});
