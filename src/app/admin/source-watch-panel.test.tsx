import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

import { SourceWatchPanel } from "./source-watch-panel";
import type { SourceWatchOverview } from "@/lib/source-watch/types";

const PIN_A = "a".repeat(64);
const PIN_B = "b".repeat(64);

function overview(overrides: Partial<SourceWatchOverview> = {}): SourceWatchOverview {
  return {
    source: "dllkids",
    intervalMs: 6 * 60 * 60 * 1000,
    active: {
      id: 1,
      source: "dllkids",
      status: "active",
      value: PIN_A,
      observedAt: "2026-11-15T02:00:00.000Z",
      adoptedAt: "2026-11-15T02:00:00.000Z",
      adoptedBy: "auto",
      cachePath: "/data/source-cache/dllkids/a.adb",
      cacheSha256: PIN_A,
      metadata: { snapshotId: 12 },
    },
    candidate: null,
    state: {
      source: "dllkids",
      lastCheckAt: "2026-11-15T08:00:00.000Z",
      lastSuccessAt: "2026-11-15T08:00:00.000Z",
      lastError: null,
      candidateReason: "unchanged",
      updatedAt: "2026-11-15T08:00:00.000Z",
    },
    history: [],
    diff: null,
    rollbackTarget: null,
    note: "dllkids 索引无签名。",
    ...overrides,
  };
}

const BLOCKED_CANDIDATE: SourceWatchOverview = overview({
  candidate: {
    id: 2,
    source: "dllkids",
    status: "candidate",
    value: PIN_B,
    observedAt: "2026-11-15T08:00:00.000Z",
    adoptedAt: null,
    adoptedBy: null,
    cachePath: "/data/source-cache/dllkids/b.adb",
    cacheSha256: PIN_B,
    metadata: { blocked: true, snapshotId: 13 },
  },
  state: {
    source: "dllkids",
    lastCheckAt: "2026-11-15T08:00:00.000Z",
    lastSuccessAt: "2026-11-15T08:00:00.000Z",
    lastError: null,
    candidateReason: "same_version_hash_changed",
    updatedAt: "2026-11-15T08:00:00.000Z",
  },
  diff: {
    activeCount: 1,
    candidateCount: 1,
    added: [],
    removed: [],
    upgraded: [],
    downgraded: [],
    sameVersionHashChanges: [
      { name: "luci", version: "1.0", from: PIN_A, to: PIN_B },
    ],
  },
  rollbackTarget: { value: "c".repeat(64), observedAt: "2026-11-14T02:00:00.000Z" },
  history: [
    {
      id: 3,
      source: "dllkids",
      fromPin: PIN_A,
      toPin: PIN_B,
      reason: "blocked_same_version_hash",
      snapshotId: null,
      createdAt: "2026-11-15T08:00:00.000Z",
    },
    {
      id: 2,
      source: "dllkids",
      fromPin: "c".repeat(64),
      toPin: PIN_A,
      reason: "adopted",
      snapshotId: 12,
      createdAt: "2026-11-15T02:00:00.000Z",
    },
  ],
});

describe("SourceWatchPanel", () => {
  it("shows active and candidate pins with a blocked same-version hash change", () => {
    const html = renderToStaticMarkup(<SourceWatchPanel overview={BLOCKED_CANDIDATE} />);
    expect(html).toContain("源固定（dllkids）");
    expect(html).toContain("当前 pin");
    expect(html).toContain("候选 pin");
    expect(html).toContain("同版本包哈希发生变化，已阻止自动采纳");
    expect(html).toContain("luci");
    expect(html).toContain("强制采纳候选");
    expect(html).toContain("回滚上一 pin");
    expect(html).toContain("同版本哈希变化，已阻止");
    expect(html).toContain("快照 #12");
  });

  it("shows a safe candidate with plain adopt and no rollback target", () => {
    const safe = overview({
      candidate: {
        id: 4,
        source: "dllkids",
        status: "candidate",
        value: PIN_B,
        observedAt: "2026-11-15T08:00:00.000Z",
        adoptedAt: null,
        adoptedBy: null,
        cachePath: null,
        cacheSha256: null,
        metadata: { blocked: false },
      },
      diff: {
        activeCount: 1,
        candidateCount: 2,
        added: ["kmod-foo"],
        removed: [],
        upgraded: [{ name: "luci", from: "1.0", to: "1.1" }],
        downgraded: [],
        sameVersionHashChanges: [],
      },
    });
    const html = renderToStaticMarkup(<SourceWatchPanel overview={safe} />);
    expect(html).toContain("采纳候选");
    expect(html).not.toContain("强制采纳候选");
    expect(html).toContain("新增 1 · 移除 0 · 升级 1 · 降级 0");
    expect(html).toContain("kmod-foo");
    expect(html).not.toContain("可回滚到");
  });
});
