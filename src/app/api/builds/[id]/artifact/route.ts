import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/current-session";
import { getBuildService, type ArtifactFileInfo } from "@/lib/builds";
import { artifactContainerName } from "@/lib/builds/service";
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

interface ContainerHeaders {
  /** Browser-facing filename of the bytes on the wire: the image, or the archive. */
  servedName: string;
  /** Content type of the bytes on the wire. */
  contentType: string;
  /** sha256 of the bytes actually sent; null when the site has not hashed them. */
  containerSha256: string | null;
  imageName: string;
  imageSha256: string | null;
  imageSize: number | null;
  /** Only the cached-file path implements Range; the streaming fallback must not claim it. */
  acceptRanges: boolean;
}

/**
 * Headers for a served artifact. The site unpacks the GitHub ZIP once, so the
 * body is normally the image itself: name, content type and checksum all
 * describe those bytes. `X-Image-*` keeps publishing the manifest facts (they
 * match the body now; they still let a client verify a build record).
 */
function containerHeaders(input: ContainerHeaders): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": input.contentType,
    "content-disposition": disposition(input.servedName),
    "cache-control": "private, no-store",
    "x-image-name": input.imageName,
  };
  if (input.acceptRanges) headers["accept-ranges"] = "bytes";
  if (input.containerSha256) headers["x-checksum-sha256"] = input.containerSha256;
  if (input.imageSha256) headers["x-image-sha256"] = input.imageSha256;
  if (input.imageSize !== null) headers["x-image-size"] = String(input.imageSize);
  return headers;
}

function headersForFile(file: ArtifactFileInfo): Record<string, string> {
  return containerHeaders({
    servedName: file.containerName,
    contentType: file.contentType,
    containerSha256: file.sha256,
    imageName: file.name,
    imageSha256: file.imageSha256,
    imageSize: file.imageSize,
    acceptRanges: true,
  });
}

function headersForRecord(record: {
  artifactName: string | null;
  artifactSha256?: string | null;
  artifactSize?: number | null;
  artifactContainerSha256?: string | null;
}): Record<string, string> {
  const imageName = record.artifactName as string;
  return containerHeaders({
    servedName: artifactContainerName(imageName),
    contentType: "application/zip",
    containerSha256: record.artifactContainerSha256 ?? null,
    imageName,
    imageSha256: record.artifactSha256 ?? null,
    imageSize: typeof record.artifactSize === "number" ? record.artifactSize : null,
    acceptRanges: false,
  });
}

/**
 * Serve a cached artifact with single-range support (ticket 14).
 *
 * 200 for a full body, 206 with `Content-Range` for `bytes=` ranges, 416 when
 * the range cannot be satisfied (resumable clients expect it) and readable
 * JSON errors for every failure instead of a stack trace.
 */
function serveFile(file: ArtifactFileInfo, request: Request): Response {
  const headers = headersForFile(file);
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
        ...headersForRecord(build),
        ...(artifact.size ? { "content-length": String(artifact.size) } : {}),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof ArtifactSizeLimitError) {
      return jsonError(
        "artifact-too-large",
        `产物 ${formatBytes(error.actualBytes)} 超过本站单产物上限 ${formatBytes(error.limitBytes)}（缓存/磁盘保护阈值，产物已压缩后仍超过），无法缓存下载`,
        413,
      );
    }
    if (/no longer available/i.test(message)) {
      return jsonError(
        "expired",
        "artifact 已过期或已被清理（GitHub artifact 保留 7 天，站点缓存按保留策略清理）",
        409,
      );
    }
    console.error("artifact download failed", error);
    return jsonError("download-failed", "artifact download failed", 502);
  }
}
