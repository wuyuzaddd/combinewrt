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
  let sweeping = false;

  async function sweep(): Promise<void> {
    if (sweeping) return;
    sweeping = true;
    try {
      // Restart recovery starts with the queue: queued builds are dispatched
      // FIFO up to MAX_CONCURRENT_BUILDS before anything is polled (ticket 13).
      try {
        await service.pump();
      } catch (error) {
        logger.error("[combinewrt] reconciler queue pump failed", error);
      }
      for (const build of service.listActive(100)) {
        // The queue owns queued builds; polling them would race the dispatcher.
        if (build.status === "queued") continue;
        try {
          await service.refresh(build.id);
        } catch (error) {
          logger.error(`[combinewrt] reconciler failed for build ${build.id}`, error);
        }
      }
    } finally {
      sweeping = false;
    }
  }

  return {
    sweep,
    start() {
      if (timer) return;
      logger.error("[combinewrt] reconciler started");
      void sweep().catch((error) => logger.error("[combinewrt] reconciler sweep failed", error));
      timer = setInterval(
        () => void sweep().catch((error) => logger.error("[combinewrt] reconciler sweep failed", error)),
        intervalMs,
      );
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
}
