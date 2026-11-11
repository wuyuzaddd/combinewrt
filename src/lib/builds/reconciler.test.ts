import { describe, expect, it, vi } from "vitest";
import { createReconciler } from "./reconciler";
import type { BuildService } from "./service";

function service(overrides: Partial<BuildService>): BuildService {
  return {
    listActive: () => [],
    refresh: vi.fn(async () => null),
    ...overrides,
  } as unknown as BuildService;
}

describe("reconciler", () => {
  it("refreshes every active build and continues after one fails", async () => {
    const refreshed: string[] = [];
    const refresh = vi.fn(async (id: string) => {
      if (id === "bad") throw new Error("network down");
      refreshed.push(id);
      return null;
    });
    const reconciler = createReconciler(
      service({
        listActive: () => [
          { id: "a", status: "queued" },
          { id: "bad", status: "running" },
          { id: "b", status: "running" },
        ] as never,
        refresh,
      }),
      { logger: { error: () => {} } },
    );

    await reconciler.sweep();

    expect(refreshed).toEqual(["a", "b"]);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("does not overlap sweeps", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const refresh = vi.fn(async () => {
      await gate;
      return null;
    });
    const reconciler = createReconciler(
      service({ listActive: () => [{ id: "a", status: "running" }] as never, refresh }),
      { logger: { error: () => {} } },
    );

    const first = reconciler.sweep();
    await reconciler.sweep();
    expect(refresh).toHaveBeenCalledTimes(1);

    release();
    await first;
  });
});
