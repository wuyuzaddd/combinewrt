import type { BaseChannel } from "../domain/types";
import type { BaseVersion } from "./types";
import { STABLE_VERSION, imageBuilderUrl } from "./releases";

export type BaseVersionInput = Omit<BaseVersion, "createdAt" | "channel"> & { channel?: BaseChannel };

export type BaseVersionInputResult =
  | { ok: true; value: BaseVersionInput }
  | { ok: false; errors: string[] };

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateBaseVersionInput(input: unknown): BaseVersionInputResult {
  const errors: string[] = [];
  if (!input || typeof input !== "object") {
    return { ok: false, errors: ["请求体必须是 JSON 对象"] };
  }
  const body = input as Record<string, unknown>;
  const version = typeof body.version === "string" ? body.version.trim() : "";
  if (!STABLE_VERSION.test(version)) errors.push("版本号必须是稳定版本，例如 25.12.3");

  const releaseDate = typeof body.releaseDate === "string" ? body.releaseDate.trim() : "";
  if (!isIsoDate(releaseDate)) errors.push("发布日期必须是有效的 YYYY-MM-DD 日期");

  const expectedUrl = version && STABLE_VERSION.test(version) ? imageBuilderUrl(version) : null;
  const url = typeof body.imageBuilderUrl === "string" ? body.imageBuilderUrl.trim() : "";
  if (!expectedUrl) {
    errors.push("无法根据版本号生成 ImageBuilder URL");
  } else if (url !== expectedUrl) {
    errors.push(`ImageBuilder URL 与版本 ${version} 不匹配，应为 ${expectedUrl}`);
  }

  const sha = typeof body.imageBuilderSha256 === "string" ? body.imageBuilderSha256.trim().toLowerCase() : "";
  if (!/^[0-9a-f]{64}$/.test(sha)) errors.push("ImageBuilder sha256 必须是 64 位十六进制");

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      version,
      releaseDate,
      imageBuilderUrl: url,
      imageBuilderSha256: sha,
    },
  };
}
