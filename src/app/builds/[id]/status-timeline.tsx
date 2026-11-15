import type { BuildEvent, BuildEventSource } from "@/lib/builds/types";

const EVENT_SOURCE_LABELS: Record<BuildEventSource, string> = {
  create: "创建",
  dispatch: "派发",
  poll: "轮询",
  cancel: "取消",
  timeout: "超时",
};

export function StatusTimeline({ events }: { events: BuildEvent[] }) {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm">
      <h2 className="font-medium">状态时间线</h2>
      {events.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500">
          此构建创建于时间线功能上线之前，没有可显示的事件记录。
        </p>
      ) : (
        <ol className="mt-3 space-y-2">
          {events.map((event) => (
            <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs" key={event.id}>
              <span className="w-40 shrink-0 text-slate-500">
                {new Date(event.createdAt).toLocaleString("zh-CN")}
              </span>
              <span className="font-mono text-slate-300">
                {event.fromStatus ?? "—"} → {event.toStatus}
              </span>
              <span className="rounded-full bg-slate-800 px-2 py-0.5 text-slate-400">
                {EVENT_SOURCE_LABELS[event.source] ?? event.source}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
