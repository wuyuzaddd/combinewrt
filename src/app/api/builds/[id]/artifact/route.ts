import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current-session";
import { getBuildService, type ArtifactFileInfo } from "@/lib/builds";
import { ArtifactSizeLimitError, formatBytes } from "@/lib/image/postprocess";
import { formatContentRange, parseRangeHeader } from "@/lib/builds/range";

function jsonError(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, error: message }, { status });
}

function asciiFilename(name: string): string {
  return name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
}

function disposition(name: string): string {
  return `attachment; filename="${asciiFilename(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function baseHeaders(file: ArtifactFileInfo): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": file.contentType,
    "content-disposition": disposition(file.name),
    "cache-control": "private, no-store",
    "accept-ranges": "bytes",
  };
  if (file.sha256) headers["x-checksum-sha256"] = file.sha256;
  return headers;
}

/**
 * Serve a cached artifact with single-range support (ticket 14).
 *
 * 200 for a full body, 206 with `Content-Range` for `bytes=` ranges, 416 when
 * the range cannot be satisfied (resumable clients expect it) and readable
 * JSON errors for every failure instead of a stack trace.
 */
function serveFile(file: ArtifactFileInfo, request: Request): Response {
  const headers = baseHeaders(file);
  const range = parseRangeHeader(request.headers.get("range"), file.size);

  if (range.kind === "unsatisfiable") {
    return new NextResponse(null, {
      status: 416,
      headers: { ...headers, "content-range": formatContentRange(null, null, file.size) },
    });
  }

  const stream = (start?: number, end?: number) =>
    Readable.toWeb(createReadStream(file.path, start === undefined ? {} : { start, end })) as ReadableStream<Uint8Array>;

  if (range.kind === "range") {
    return new NextResponse(stream(range.start, range.end), {
      status: 206,
      headers: {
        ...headers,
        "content-range": formatContentRange(range.start, range.end, file.size),
        "content-length": String(range.end - range.start + 1),
      },
    });
  }

  return new NextResponse(stream(), {
    status: 200,
    headers: { ...headers, "content-length": String(file.size) },
  });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return jsonError("unauthorized", "unauthorized", 401);

  const { id } = await params;
  const service = getBuildService();
  const build = await service.refresh(id);
  if (!build) return jsonError("not-found", "build not found", 404);
  if (build.status === "failed") {
    return jsonError("build-failed", build.error ?? "build failed", 409);
  }
  if (build.status !== "succeeded" || !build.artifactName) {
    return jsonError("not-ready", "artifact is not ready", 409);
  }

  try {
    const file = await service.artifactFile(id);
    if (file) return serveFile(file, request);

    // No cache index in this deployment: fall back to the streaming download.
    const artifact = await service.artifact(id);
    if (!artifact) {
      return jsonError("expired", "artifact 已过期或已被清理（请重新构建以生成新的产物）", 409);
    }
    return new Response(artifact.body as unknown as BodyInit, {
      status: 200,
      headers: {
        "content-type": artifact.contentType,
        "content-disposition": disposition(artifact.name),
        "cache-control": "private, no-store",
        ...(artifact.size ? { "content-length": String(artifact.size) } : {}),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof ArtifactSizeLimitError) {
      return jsonError(
        "artifact-too-large",
        `产物 ${formatBytes(error.actualBytes)} 超过单产物 ${formatBytes(error.limitBytes)} 上限，无法缓存下载`,
        413,
      );
    }
    if (/no longer available/i.test(message)) {
      return jsonError(
        "expired",
        "artifact 已过期或已被清理（GitHub Release 默认保留，站点缓存保留 7 天）",
        409,
      );
    }
    console.error("artifact download failed", error);
    return jsonError("download-failed", "artifact download failed", 502);
  }
}
