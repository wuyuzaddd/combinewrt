import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StatusTimeline } from "./status-timeline";

describe("StatusTimeline", () => {
  it("renders each transition with its source", () => {
    const html = renderToStaticMarkup(
      <StatusTimeline
        events={[
          {
            id: 1,
            buildId: "b",
            fromStatus: null,
            toStatus: "queued",
            source: "create",
            createdAt: "2026-11-15T00:00:00.000Z",
          },
          {
            id: 2,
            buildId: "b",
            fromStatus: "queued",
            toStatus: "succeeded",
            source: "poll",
            createdAt: "2026-11-15T00:01:00.000Z",
          },
        ]}
      />,
    );
    expect(html).toContain("queued → succeeded");
    expect(html).toContain("轮询");
  });

  it("explains the legacy fallback when no events exist", () => {
    const html = renderToStaticMarkup(<StatusTimeline events={[]} />);
    expect(html).toContain("时间线功能上线之前");
  });
});
