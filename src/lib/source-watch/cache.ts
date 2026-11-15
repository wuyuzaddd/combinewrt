import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sha256Hex } from "./observe";
import type { WatchSourceId } from "./types";

/**
 * Cached index bytes are content-addressed by pin, so an old pin stays
 * readable for audit and rollback even after upstream rotates or disappears.
 */
export interface CachedIndex {
  path: string;
  sha256: string;
}

export function sourceCachePath(
  cacheDir: string,
  source: WatchSourceId,
  pin: string,
  extension = ".adb",
): string {
  const safePin = pin.replace(/[^A-Za-z0-9._-]/g, "_");
  return join(cacheDir, source, `${safePin}${extension}`);
}

export async function writeCachedIndex(input: {
  cacheDir: string;
  source: WatchSourceId;
  pin: string;
  bytes: Buffer;
  extension?: string;
}): Promise<CachedIndex> {
  const sha256 = sha256Hex(input.bytes);
  const path = sourceCachePath(input.cacheDir, input.source, input.pin, input.extension);
  await mkdir(join(input.cacheDir, input.source), { recursive: true });
  try {
    await writeFile(path, input.bytes, { flag: "wx" });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EEXIST") throw error;
    // Content-addressed files are immutable; verify rather than overwrite so a
    // corrupt cache entry cannot silently poison a rollback.
    const existing = await readFile(path);
    if (sha256Hex(existing) !== sha256) {
      throw new Error(`cached source index at ${path} does not match its pin ${input.pin}`);
    }
  }
  return { path, sha256 };
}

export async function readCachedIndex(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}
