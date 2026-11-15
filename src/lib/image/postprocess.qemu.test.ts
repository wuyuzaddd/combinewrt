import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, open, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { planPostprocess, runPostprocess, type PostprocessStep } from "./postprocess";

const execFileAsync = promisify(execFile);

async function qemuAvailable(): Promise<boolean> {
  try {
    await execFileAsync("qemu-img", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

const hasQemu = await qemuAvailable();

async function sha256(path: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function runStep(step: PostprocessStep): Promise<void> {
  if (step.kind === "decompress") {
    const { stdout } = await execFileAsync(step.command, step.args, { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });
    await writeFile(step.outputPath, stdout);
    return;
  }
  await execFileAsync(step.command, step.args, { maxBuffer: 64 * 1024 * 1024 });
}

const directories: string[] = [];

afterAll(async () => {
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
});

describe.skipIf(!hasQemu)("qemu-img conversion (local integration)", () => {
  it("converts a fixture raw image into VMDK and qcow2 that qemu-img info recognises", async () => {
    const directory = await mkdtemp(join(tmpdir(), "combinewrt-qemu-"));
    directories.push(directory);

    const rawPath = join(directory, "fixture.img");
    const handle = await open(rawPath, "w");
    await handle.truncate(1024 * 1024);
    await handle.close();

    for (const kind of ["vmdk", "qcow2"] as const) {
      const outputPath = join(directory, `fixture.${kind}`);
      const conversion = planPostprocess({
        kind,
        sourcePath: rawPath,
        rawPath,
        outputPath,
        compressed: false,
      });

      const manifest = await runPostprocess(conversion, {
        runner: { run: runStep },
        files: {
          sha256,
          size: async (path) => (await stat(path)).size,
        },
      });

      const info = JSON.parse(
        (await execFileAsync("qemu-img", ["info", "--output=json", outputPath])).stdout,
      ) as { format: string; "virtual-size": number };

      expect(info.format).toBe(kind);
      expect(info["virtual-size"]).toBe(1024 * 1024);
      expect(manifest.artifact).toBe(kind);
      expect(manifest.source.sha256).toBe(await sha256(rawPath));
      expect(manifest.converted.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(manifest.converted.sizeBytes).toBeGreaterThan(0);
      expect(manifest.steps.at(-1)).toContain(`-O ${kind}`);
    }
  }, 30_000);
});
