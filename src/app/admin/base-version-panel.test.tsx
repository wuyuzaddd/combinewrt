import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

import { BaseVersionPanel } from "./base-version-panel";
import type { BaseVersionState } from "@/lib/base/types";

const STATE: BaseVersionState = {
  active: {
    version: "25.12.2",
    releaseDate: "2026-09-08",
    imageBuilderUrl: "https://downloads.immortalwrt.org/releases/25.12.2/ib.tar.zst",
    imageBuilderSha256: "b9b290f5ef60a22bccd5bdca9c1e7523b8fc84e60462afbf550e20db94acf2c6",
    createdAt: "2026-09-08T00:00:00.000Z",
  },
  previous: null,
  candidate: null,
  check: null,
  smoke: null,
  supplementBuild: null,
};

describe("BaseVersionPanel", () => {
  it("shows the active baseline and the manual version list", () => {
    const html = renderToStaticMarkup(
      <BaseVersionPanel
        state={STATE}
        repo="wuyuzaddd/combinewrt-build"
        versions={[
          STATE.active!,
          {
            version: "25.12.3",
            releaseDate: "2026-10-01",
            imageBuilderUrl: "https://downloads.immortalwrt.org/releases/25.12.3/ib.tar.zst",
            imageBuilderSha256: "a".repeat(64),
            createdAt: "2026-10-01T00:00:00.000Z",
          },
        ]}
      />,
    );
    expect(html).toContain("登记版本");
    expect(html).toContain("已登记版本（候选，需手动采用）");
    expect(html).toContain("25.12.3");
    expect(html).toContain("编辑");
    expect(html).toContain("采用");
  });
});
