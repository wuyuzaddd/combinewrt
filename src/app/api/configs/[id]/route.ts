import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current-session";
import { getDatabase } from "@/lib/db";
import { createSavedConfigStore, describeConfig, isConfigDocument } from "@/lib/configs/store";

const NAME_MAX = 80;

function store() {
  return createSavedConfigStore(getDatabase());
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const row = store().get(id);
  if (!row) return NextResponse.json({ ok: false, error: "not-found" }, { status: 404 });
  return NextResponse.json({
    ok: true,
    config: { id: row.id, name: row.name, document: row.document, summary: describeConfig(row.document) },
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { name?: unknown; document?: unknown } | null;
  if (!body) return NextResponse.json({ ok: false, error: "invalid-json" }, { status: 400 });

  let name: string | undefined;
  if (body.name !== undefined) {
    const trimmed = typeof body.name === "string" ? body.name.trim() : "";
    if (trimmed.length === 0 || trimmed.length > NAME_MAX) {
      return NextResponse.json({ ok: false, issues: [`名称不能为空，且不超过 ${NAME_MAX} 个字符`] }, { status: 400 });
    }
    name = trimmed;
  }
  let document;
  if (body.document !== undefined) {
    if (!isConfigDocument(body.document)) {
      return NextResponse.json({ ok: false, issues: ["不是有效的构建配置文档"] }, { status: 400 });
    }
    document = body.document;
  }
  const row = store().update(id, { name, document });
  if (!row) return NextResponse.json({ ok: false, error: "not-found" }, { status: 404 });
  return NextResponse.json({ ok: true, config: { id: row.id, name: row.name, updatedAt: row.updatedAt } });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const removed = store().remove(id);
  if (!removed) return NextResponse.json({ ok: false, error: "not-found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
