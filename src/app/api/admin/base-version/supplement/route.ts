import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current-session";
import { getBaseVersionService, readBaseVersionState } from "@/lib/base";
import { getConfig } from "@/lib/config";
import { listWorkflowRuns } from "@/lib/builds/github";

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const config = getConfig();
  if (config.buildAdapter !== "github" || !config.buildRepo || !config.buildRepoToken) {
    return NextResponse.json({ ok: false, error: "当前未启用 GitHub 构建适配器，无法触发 supplement 构建" }, { status: 400 });
  }

  const state = readBaseVersionState();
  if (!state.active) {
    return NextResponse.json({ ok: false, error: "没有启用的基础版本，无法触发 supplement 构建" }, { status: 400 });
  }

  try {
    const runs = await listWorkflowRuns({
      repo: config.buildRepo,
      token: config.buildRepoToken,
      workflow: config.supplementWorkflow,
      limit: 10,
    });
    const running = runs.find(
      (run) => run.status !== "completed" && run.title.includes(`packages ${state.active!.version}`),
    );
    if (running) {
      return NextResponse.json(
        { ok: false, error: `supplement 构建正在运行（run ${running.id}），请等待完成` },
        { status: 409 },
      );
    }

    const previous = state.supplementBuild;
    if (
      previous &&
      !previous.error &&
      previous.baseVersion === state.active.version &&
      Date.now() - Date.parse(previous.triggeredAt) < 5 * 60 * 1000
    ) {
      return NextResponse.json(
        { ok: false, error: "刚刚已触发 supplement 构建，请等待运行出现在列表中" },
        { status: 409 },
      );
    }

    const supplementBuild = await getBaseVersionService().triggerSupplementBuildNow(state.active.version);
    return NextResponse.json({ ok: true, supplementBuild, state: readBaseVersionState() });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "supplement 构建触发失败" },
      { status: 502 },
    );
  }
}
