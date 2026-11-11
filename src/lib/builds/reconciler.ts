import type { BuildService } from "./service";

export interface Reconciler {
  sweep(): Promise<void>;
  start(): void;
  stop(): void;
}

export function createReconciler(
  service: BuildService,
  options: { intervalMs?: number; logger?: Pick<Console, "error"> } = {},
): Reconciler {
  const { intervalMs = 15_000, logger = console } = options;
  let timer: ReturnType<typeof setInterval> | undefined;

  async function sweep(): Promise<void> {
    for (const build of service.list(100)) {
      if (build.status !== "queued" && build.status !== "running") continue;
      try {
        await service.refresh(build.id);
      } catch (error) {
        logger.error(`[combinewrt] reconciler failed for build ${build.id}`, error);
      }
    }
  }

  return {
    sweep,
    start() {
      if (timer) return;
      void sweep();
      timer = setInterval(() => void sweep(), intervalMs);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
}
