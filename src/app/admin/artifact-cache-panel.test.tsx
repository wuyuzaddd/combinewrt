import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ArtifactCachePanel } from "./artifact-cache-panel";

const GIB = 1024 ** 3;

describe("ArtifactCachePanel", () => {
  it("shows the cache size and the last cleanup", () => {
    const html = renderToStaticMarkup(
      <ArtifactCachePanel
        retentionDays={7}
        maxBytes={20 * GIB}
        stats={{ entries: 3, bytes: 2 * GIB }}
        retention={{
          at: "2026-11-15T00:00:00.000Z",
          removed: 2,
          removedBytes: GIB,
          remainingBytes: 2 * GIB,
          entries: 3,
          failed: [],
        }}
      />,
    );

    expect(html).toContain("产物缓存");
    expect(html).toContain("3 个文件");
    expect(html).toContain("2 GiB");
    expect(html).toContain("删除");
    expect(html).toContain("保留 7 天");
    expect(html).toContain("20 GiB");
    expect(html).not.toContain("清理失败");
  });

  it("shows the last failure reason", () => {
    const html = renderToStaticMarkup(
      <ArtifactCachePanel
        retentionDays={7}
        maxBytes={0}
        stats={{ entries: 0, bytes: 0 }}
        retention={{
          at: "2026-11-15T00:00:00.000Z",
          removed: 0,
          failed: ["b1/a.img: EACCES"],
        }}
      />,
    );

    expect(html).toContain("失败原因：b1/a.img: EACCES");
    expect(html).toContain("不限制");
  });

  it("says the cleanup has not run yet", () => {
    const html = renderToStaticMarkup(
      <ArtifactCachePanel retentionDays={7} maxBytes={0} stats={{ entries: 0, bytes: 0 }} retention={null} />,
    );
    expect(html).toContain("尚未运行清理");
  });
});
