import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Unzip, UnzipInflate } from "fflate";

/** One file pulled out of a ZIP container. */
export interface ExtractedFile {
  /** Entry name as stored in the archive (basename only). */
  name: string;
  size: number;
  sha256: string;
}

/**
 * Extract one file of a ZIP archive.
 *
 * GitHub serves a workflow artifact as a ZIP that holds the image plus a small
 * `manifest.json` (and keeps the build's directory layout, e.g.
 * `bin/targets/x86/64/<image>`), so the site used to hand the archive to the
 * browser. Unpacking the image entry once here lets the download be the real
 * file, with its own name, type and checksum.
 *
 * `preferredName` selects the entry by basename (the artifact name is what the
 * build records). Without it the first file entry is used. Returns null when
 * nothing matches or the entry cannot be read: the caller then keeps serving
 * the archive, because guessing would be worse than the honest container.
 */
export async function extractSingleFile(
  zipPath: string,
  outPath: string,
  preferredName?: string,
): Promise<ExtractedFile | null> {
  const hash = createHash("sha256");
  const sink = createWriteStream(outPath);
  let entries = 0;
  let entryName: string | null = null;
  let size = 0;
  let failure: Error | null = null;

  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  const written = pipeline(meter, sink);

  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.onfile = (file) => {
    // Directory entries carry a trailing slash and no bytes of their own.
    if (file.name.endsWith("/")) return;
    const base = file.name.split("/").pop() ?? "";
    const wanted = preferredName ? base === preferredName : entries === 0;
    if (!wanted) return;
    entries += 1;
    entryName = file.name;
    file.ondata = (error, chunk, final) => {
      if (error) {
        failure = error instanceof Error ? error : new Error(String(error));
        return;
      }
      if (chunk && chunk.length > 0) meter.write(Buffer.from(chunk));
      if (final) meter.end();
    };
    file.start();
  };

  const feed = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      try {
        unzip.push(chunk, false);
        callback();
      } catch (error) {
        callback(error as Error);
      }
    },
    flush(callback) {
      try {
        unzip.push(new Uint8Array(0), true);
        callback();
      } catch (error) {
        callback(error as Error);
      }
    },
  });

  let readFailure: Error | null = null;
  try {
    await pipeline(createReadStream(zipPath), feed);
  } catch (error) {
    readFailure = error instanceof Error ? error : new Error(String(error));
  }
  // The zip stream can end before every member has been handed over; make sure
  // the sink is closed either way before deciding.
  meter.end();
  try {
    await written;
  } catch (error) {
    readFailure ??= error instanceof Error ? error : new Error(String(error));
  }

  if (readFailure || failure || entries === 0 || entryName === null) return null;
  return { name: (entryName as string).split("/").pop() ?? "artifact.bin", size, sha256: hash.digest("hex") };
}
