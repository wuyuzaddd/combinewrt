import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { RecentRunsPanel } from "./recent-runs-panel";

describe("RecentRunsPanel", () => {
  it("renders workflow titles, state and run links", () => {
    const html = renderToStaticMarkup(
      <RecentRunsPanel
        error={null}
        runs={[
          {
            id: "43681387704",
            workflow: "build.yml",
            status: "completed",
            conclusion: "success",
            title: "combinewrt image",
            createdAt: "2026-11-15T06:00:00Z",
            url: "https://github.com/wuyuzaddd/combinewrt-build/actions/runs/43681387704",
          },
        ]}
      />,
    );
    expect(html).toContain("combinewrt image");
    expect(html).toContain("build.yml");
    expect(html).toContain("成功");
    expect(html).toContain("43681387704");
  });

  it("renders an error or the empty state", () => {
    expect(renderToStaticMarkup(<RecentRunsPanel error="token 无效" runs={[]} />)).toContain("token 无效");
    expect(renderToStaticMarkup(<RecentRunsPanel error={null} runs={[]} />)).toContain("暂无运行记录");
  });
});
