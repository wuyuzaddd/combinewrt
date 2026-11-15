import type { ArtifactKind } from "../domain/types";

/**
 * Postprocessing for artifacts the ImageBuilder does not produce directly.
 *
 * VMDK and qcow2 variants are built from the raw combined image: the workflow
 * builds `<...>.img.gz`, decompresses it, and runs
 * `qemu-img convert -f raw -O vmdk|qcow2`. The manifest records the sha256 and
 * size of both the raw source and the converted artifact so downloads can be
 * verified against the plan.
 *
 * The 2 GiB per-artifact cap is ticket 14's job; this module only exposes the
 * predicate (`checkArtifactSize` / `assertArtifactSize`) and the error type to
 * enforce it later. Nothing here retries, uploads or decides retention.
 */

/** 2 GiB per artifact; ticket 14 enforces it, this module only measures. */
export const ARTIFACT_SIZE_LIMIT_BYTES = 2 * 1024 * 1024 * 1024;

export type ConvertedArtifactKind = "vmdk" | "qcow2";

/** Artifact kinds that need a qemu-img conversion; everything else is final as built. */
export function convertedArtifactKind(artifact: ArtifactKind): ConvertedArtifactKind | null {
  if (artifact === "vmdk" || artifact === "qcow2") return artifact;
  return null;
}

export interface PostprocessStep {
  kind: "decompress" | "convert";
  command: string;
  args: string[];
  /** File the command writes. */
  outputPath: string;
}

export interface PostprocessPlanInput {
  kind: ConvertedArtifactKind;
  /** The ImageBuilder product, e.g. `...-ext4-combined-efi.img.gz`. */
  sourcePath: string;
  /** The uncompressed raw image handed to qemu-img. */
  rawPath: string;
  /** The converted artifact, e.g. `...-ext4-combined-efi.vmdk`. */
  outputPath: string;
  /** Combined images are gzip compressed by default (`CONFIG_TARGET_IMAGES_GZIP=y`). */
  compressed?: boolean;
}

export interface PostprocessPlan {
  kind: ConvertedArtifactKind;
  sourceFormat: "raw";
  sourcePath: string;
  rawPath: string;
  outputPath: string;
  compressed: boolean;
  steps: PostprocessStep[];
  /** Intermediates to drop after hashing; no raw image is archived. */
  cleanup: string[];
}

export function planPostprocess(input: PostprocessPlanInput): PostprocessPlan {
  const compressed = input.compressed ?? true;
  const steps: PostprocessStep[] = [];

  if (compressed) {
    steps.push({
      kind: "decompress",
      command: "gzip",
      args: ["-dc", input.sourcePath],
      outputPath: input.rawPath,
    });
  }

  steps.push({
    kind: "convert",
    command: "qemu-img",
    args: ["convert", "-f", "raw", "-O", input.kind, input.rawPath, input.outputPath],
    outputPath: input.outputPath,
  });

  return {
    kind: input.kind,
    sourceFormat: "raw",
    sourcePath: input.sourcePath,
    rawPath: input.rawPath,
    outputPath: input.outputPath,
    compressed,
    steps,
    cleanup: compressed && input.rawPath !== input.outputPath ? [input.rawPath] : [],
  };
}

function quoteArgument(argument: string): string {
  return /\s/.test(argument) ? `"${argument}"` : argument;
}

/** Render a step for logs and for the manifest's command trail. */
export function shellCommand(step: PostprocessStep): string {
  return [step.command, ...step.args].map(quoteArgument).join(" ");
}

export interface ArtifactFileInfo {
  path: string;
  sha256: string;
  sizeBytes: number;
}

export interface PostprocessManifest {
  schemaVersion: 1;
  artifact: ConvertedArtifactKind;
  sourceFormat: "raw";
  /** The uncompressed raw image, hashed before it is dropped. */
  source: ArtifactFileInfo;
  converted: ArtifactFileInfo;
  steps: string[];
}

/** Run one step; the caller supplies the process spawner (tests inject a fake). */
export interface PostprocessStepRunner {
  run(step: PostprocessStep): Promise<void>;
}

/** Hash and size files; the caller supplies node:fs/crypto (tests inject fakes). */
export interface PostprocessFileSystem {
  sha256(path: string): Promise<string>;
  size(path: string): Promise<number>;
  remove?(path: string): Promise<void>;
}

export interface PostprocessDeps {
  runner: PostprocessStepRunner;
  files: PostprocessFileSystem;
}

/**
 * Execute a conversion plan and return the manifest fragment for `plan.json`.
 * The raw image is hashed before `cleanup` removes it, so the manifest always
 * has both digests even though only the converted artifact is archived.
 */
export async function runPostprocess(
  plan: PostprocessPlan,
  deps: PostprocessDeps,
): Promise<PostprocessManifest> {
  for (const step of plan.steps) {
    await deps.runner.run(step);
  }

  const source: ArtifactFileInfo = {
    path: plan.rawPath,
    sha256: await deps.files.sha256(plan.rawPath),
    sizeBytes: await deps.files.size(plan.rawPath),
  };
  const converted: ArtifactFileInfo = {
    path: plan.outputPath,
    sha256: await deps.files.sha256(plan.outputPath),
    sizeBytes: await deps.files.size(plan.outputPath),
  };

  if (deps.files.remove) {
    for (const path of plan.cleanup) {
      await deps.files.remove(path);
    }
  }

  return {
    schemaVersion: 1,
    artifact: plan.kind,
    sourceFormat: "raw",
    source,
    converted,
    steps: plan.steps.map(shellCommand),
  };
}

export interface ArtifactSizeCheck {
  ok: boolean;
  actualBytes: number;
  limitBytes: number;
  message?: string;
}

const BYTE_UNITS = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"] as const;

/** Human readable binary size, e.g. `1.5 GiB`. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) throw new RangeError(`invalid byte count: ${bytes}`);
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rendered = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return `${rendered} ${BYTE_UNITS[unit]}`;
}

/** Size guard hook for the multi-artifact archive in ticket 14. */
export function checkArtifactSize(
  actualBytes: number,
  limitBytes: number = ARTIFACT_SIZE_LIMIT_BYTES,
): ArtifactSizeCheck {
  if (actualBytes <= limitBytes) {
    return { ok: true, actualBytes, limitBytes };
  }
  return {
    ok: false,
    actualBytes,
    limitBytes,
    message: `artifact is ${formatBytes(actualBytes)}, above the ${formatBytes(limitBytes)} per-artifact limit`,
  };
}

export function exceedsArtifactSizeLimit(
  actualBytes: number,
  limitBytes: number = ARTIFACT_SIZE_LIMIT_BYTES,
): boolean {
  return actualBytes > limitBytes;
}

export class ArtifactSizeLimitError extends Error {
  readonly code = "artifact-too-large";
  readonly actualBytes: number;
  readonly limitBytes: number;

  constructor(actualBytes: number, limitBytes: number, message?: string) {
    const check = checkArtifactSize(actualBytes, limitBytes);
    super(message ?? check.message ?? "artifact is above the per-artifact limit");
    this.name = "ArtifactSizeLimitError";
    this.actualBytes = actualBytes;
    this.limitBytes = limitBytes;
  }
}

/** Throw the typed error when an artifact cannot be archived. */
export function assertArtifactSize(
  actualBytes: number,
  limitBytes: number = ARTIFACT_SIZE_LIMIT_BYTES,
): void {
  if (exceedsArtifactSizeLimit(actualBytes, limitBytes)) {
    throw new ArtifactSizeLimitError(actualBytes, limitBytes);
  }
}
