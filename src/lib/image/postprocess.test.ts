import { describe, expect, it } from "vitest";
import {
  ARTIFACT_SIZE_LIMIT_BYTES,
  ArtifactSizeLimitError,
  assertArtifactSize,
  checkArtifactSize,
  exceedsArtifactSizeLimit,
  formatBytes,
  planPostprocess,
  runPostprocess,
  shellCommand,
  type PostprocessPlan,
  type PostprocessStep,
} from "./postprocess";
import { convertedArtifactKind } from "./postprocess";

const GIB = 1024 ** 3;

function sha(char: string): string {
  return char.repeat(64);
}

function plan(overrides: Partial<PostprocessPlan> = {}): PostprocessPlan {
  return {
    ...planPostprocess({
      kind: "vmdk",
      sourcePath: "bin/targets/x86/64/image.img.gz",
      rawPath: "bin/targets/x86/64/image.img",
      outputPath: "bin/targets/x86/64/image.vmdk",
    }),
    ...overrides,
  };
}

describe("convertedArtifactKind", () => {
  it("only converts VMDK and qcow2 variants", () => {
    expect(convertedArtifactKind("vmdk")).toBe("vmdk");
    expect(convertedArtifactKind("qcow2")).toBe("qcow2");
    for (const artifact of ["combined", "rootfs", "emmc"] as const) {
      expect(convertedArtifactKind(artifact)).toBeNull();
    }
  });
});

describe("planPostprocess command construction", () => {
  it("decompresses the combined image and converts it as raw", () => {
    const vmdk = plan();

    expect(vmdk.kind).toBe("vmdk");
    expect(vmdk.sourceFormat).toBe("raw");
    expect(vmdk.steps).toHaveLength(2);
    expect(vmdk.steps[0]).toEqual({
      kind: "decompress",
      command: "gzip",
      args: ["-dc", "bin/targets/x86/64/image.img.gz"],
      outputPath: "bin/targets/x86/64/image.img",
    });
    expect(vmdk.steps[1]).toEqual({
      kind: "convert",
      command: "qemu-img",
      args: ["convert", "-f", "raw", "-O", "vmdk", "bin/targets/x86/64/image.img", "bin/targets/x86/64/image.vmdk"],
      outputPath: "bin/targets/x86/64/image.vmdk",
    });
  });

  it("uses the qcow2 output format", () => {
    const qcow2 = planPostprocess({
      kind: "qcow2",
      sourcePath: "image.img.gz",
      rawPath: "image.img",
      outputPath: "image.qcow2",
    });

    expect(qcow2.steps.at(-1)?.args).toEqual(["convert", "-f", "raw", "-O", "qcow2", "image.img", "image.qcow2"]);
  });

  it("skips decompression when the source is already a raw image", () => {
    const raw = planPostprocess({
      kind: "vmdk",
      sourcePath: "image.img",
      rawPath: "image.img",
      outputPath: "image.vmdk",
      compressed: false,
    });

    expect(raw.steps).toHaveLength(1);
    expect(raw.steps[0]?.kind).toBe("convert");
    expect(raw.cleanup).toEqual([]);
  });

  it("removes the intermediate raw image but keeps both end files", () => {
    expect(plan().cleanup).toEqual(["bin/targets/x86/64/image.img"]);
  });

  it("renders a shell command for logs and manifests", () => {
    const step = plan().steps[1] as PostprocessStep;

    expect(shellCommand(step)).toBe(
      "qemu-img convert -f raw -O vmdk bin/targets/x86/64/image.img bin/targets/x86/64/image.vmdk",
    );
    expect(shellCommand({ ...step, args: ["convert", "-f", "raw", "with space.img", "out.vmdk"] })).toBe(
      'qemu-img convert -f raw "with space.img" out.vmdk',
    );
  });
});

describe("runPostprocess", () => {
  it("records both hashes and sizes in the manifest", async () => {
    const steps: string[] = [];
    const removed: string[] = [];
    const digests: Record<string, string> = {
      "bin/targets/x86/64/image.img": sha("a"),
      "bin/targets/x86/64/image.vmdk": sha("b"),
    };
    const sizes: Record<string, number> = {
      "bin/targets/x86/64/image.img": 3_000_000_000,
      "bin/targets/x86/64/image.vmdk": 1_500_000_000,
    };

    const manifest = await runPostprocess(plan(), {
      runner: {
        run: async (step) => {
          steps.push(shellCommand(step));
        },
      },
      files: {
        sha256: async (path) => digests[path] as string,
        size: async (path) => sizes[path] as number,
        remove: async (path) => {
          removed.push(path);
        },
      },
    });

    expect(steps).toHaveLength(2);
    expect(manifest).toEqual({
      schemaVersion: 1,
      artifact: "vmdk",
      sourceFormat: "raw",
      source: {
        path: "bin/targets/x86/64/image.img",
        sha256: sha("a"),
        sizeBytes: 3_000_000_000,
      },
      converted: {
        path: "bin/targets/x86/64/image.vmdk",
        sha256: sha("b"),
        sizeBytes: 1_500_000_000,
      },
      steps,
    });
    expect(removed).toEqual(["bin/targets/x86/64/image.img"]);
  });

  it("does not fail on an artifact above the 2 GiB cap, which ticket 14 enforces", async () => {
    const manifest = await runPostprocess(plan(), {
      runner: { run: async () => {} },
      files: {
        sha256: async () => sha("a"),
        size: async () => ARTIFACT_SIZE_LIMIT_BYTES + 1,
      },
    });

    expect(manifest.converted.sizeBytes).toBe(ARTIFACT_SIZE_LIMIT_BYTES + 1);
    expect(() => assertArtifactSize(manifest.converted.sizeBytes)).toThrow(ArtifactSizeLimitError);
  });

  it("must hash before deleting the raw image", async () => {
    const events: string[] = [];
    await runPostprocess(plan(), {
      runner: { run: async () => {} },
      files: {
        sha256: async (path) => {
          events.push(`sha:${path}`);
          return sha("a");
        },
        size: async () => 1,
        remove: async (path) => {
          events.push(`remove:${path}`);
        },
      },
    });

    expect(events.indexOf("sha:bin/targets/x86/64/image.img")).toBeLessThan(
      events.indexOf("remove:bin/targets/x86/64/image.img"),
    );
  });
});

describe("artifact size guard", () => {
  it("accepts exactly 2 GiB and rejects anything larger", () => {
    expect(ARTIFACT_SIZE_LIMIT_BYTES).toBe(2 * GIB);
    expect(exceedsArtifactSizeLimit(2 * GIB)).toBe(false);
    expect(exceedsArtifactSizeLimit(2 * GIB + 1)).toBe(true);
    expect(exceedsArtifactSizeLimit(1, 1)).toBe(false);
    expect(exceedsArtifactSizeLimit(2, 1)).toBe(true);
  });

  it("reports a readable check result", () => {
    expect(checkArtifactSize(3 * GIB)).toEqual({
      ok: false,
      actualBytes: 3 * GIB,
      limitBytes: 2 * GIB,
      message: "artifact is 3 GiB, above the 2 GiB per-artifact limit",
    });
    expect(checkArtifactSize(512 * 1024).ok).toBe(true);
  });

  it("throws a typed error for ticket 14 to catch", () => {
    try {
      assertArtifactSize(2 * GIB + 1);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ArtifactSizeLimitError);
      const limitError = error as ArtifactSizeLimitError;
      expect(limitError.code).toBe("artifact-too-large");
      expect(limitError.actualBytes).toBe(2 * GIB + 1);
      expect(limitError.limitBytes).toBe(2 * GIB);
      expect(limitError.message).toMatch(/2 GiB/);
    }
    expect(() => assertArtifactSize(2 * GIB)).not.toThrow();
  });

  it("formats sizes in binary units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1 KiB");
    expect(formatBytes(2 * 1024 ** 2)).toBe("2 MiB");
    expect(formatBytes(3 * GIB)).toBe("3 GiB");
    expect(formatBytes(1.5 * 1024)).toBe("1.5 KiB");
  });
});
