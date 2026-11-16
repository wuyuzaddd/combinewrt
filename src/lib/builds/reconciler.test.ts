import { describe, expect, it, vi } from "vitest";
import { createReconciler } from "./reconciler";
import type { BuildService } from "./service";

function service(overrides: Partial<BuildService>): BuildService {
  return {
    listActive: () => [],
    pump: vi.fn(async () => {}),
    refresh: vi.fn(async () => null),
    ...overrides,
  } as unknown as BuildService;
}

describe("reconciler", () => {
  it("dispatches the site queue, then refreshes every dispatched build", async () => {
    const refreshed: string[] = [];
    const order: string[] = [];
    const pump = vi.fn(async () => {
      order.push("pump");
    });
    const refresh = vi.fn(async (id: string) => {
      if (id === "bad") throw new Error("network down");
      order.push(`refresh:${id}`);
      refreshed.push(id);
      return null;
    });
    const reconciler = createReconciler(
      service({
        pump,
        listActive: () => [
          { id: "a", status: "running" },
          { id: "bad", status: "running" },
          { id: "b", status: "running" },
        ] as never,
        refresh,
      }),
      { logger: { error: () => {} } },
    );

    await reconciler.sweep();

    expect(order[0]).toBe("pump");
    expect(refreshed).toEqual(["a", "b"]);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("leaves queued builds to the queue instead of polling them", async () => {
    const refresh = vi.fn(async () => null);
    const reconciler = createReconciler(
      service({
        listActive: () => [
          { id: "waiting", status: "queued" },
          { id: "running", status: "running" },
        ] as never,
        refresh,
      }),
      { logger: { error: () => {} } },
    );

    await reconciler.sweep();

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith("running");
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
