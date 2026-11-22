import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current-session";
import { getDatabase } from "@/lib/db";
import { createSavedConfigStore, describeConfig, isConfigDocument } from "@/lib/configs/store";

const NAME_MAX = 80;

function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  if (name.length === 0 || name.length > NAME_MAX) return null;
  return name;
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const store = createSavedConfigStore(getDatabase());
  return NextResponse.json({
    ok: true,
    configs: store.list().map((row) => ({
      id: row.id,
      name: row.name,
      sourceBuildId: row.sourceBuildId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      summary: describeConfig(row.document),
    })),
  });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as
    | { name?: unknown; document?: unknown; sourceBuildId?: unknown }
    | null;
  if (!body) return NextResponse.json({ ok: false, error: "invalid-json" }, { status: 400 });
  const name = cleanName(body.name);
  if (!name) {
    return NextResponse.json(
      { ok: false, issues: [`名称不能为空，且不超过 ${NAME_MAX} 个字符`] },
      { status: 400 },
    );
  }
  if (!isConfigDocument(body.document)) {
    return NextResponse.json({ ok: false, issues: ["不是有效的构建配置文档"] }, { status: 400 });
  }
  const store = createSavedConfigStore(getDatabase());
  if (store.count() >= 200) {
    return NextResponse.json({ ok: false, issues: ["最多保存 200 份配置，请先删除一些"] }, { status: 409 });
  }
  const row = store.create({
    name,
    document: body.document,
    sourceBuildId: typeof body.sourceBuildId === "string" ? body.sourceBuildId : null,
  });
  return NextResponse.json({ ok: true, config: { id: row.id, name: row.name } }, { status: 201 });
}
