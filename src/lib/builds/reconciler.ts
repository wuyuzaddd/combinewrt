import type { BuildRetryService } from "./retry";
import type { BuildService } from "./service";

export interface Reconciler {
  sweep(): Promise<void>;
  start(): void;
  stop(): void;
}

export function createReconciler(
  service: BuildService,
  options: { intervalMs?: number; logger?: Pick<Console, "error">; retry?: BuildRetryService } = {},
): Reconciler {
  const { intervalMs = 15_000, logger = console, retry } = options;
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
          const refreshed = await service.refresh(build.id);
          // A failed download usually means the dllkids feed rotated and the
          // pinned apk is gone; the retry queue re-plans once a fresh index is
          // adopted instead of letting the user re-submit by hand.
          if (retry && refreshed) retry.observe(refreshed);
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
