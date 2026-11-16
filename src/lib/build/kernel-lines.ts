import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseKernelLineRegistry, type KernelLineRegistry, type SourceKernelLine } from "./source";

/** Checked-in kernel-line registry the site and the CLI share. */
export const DEFAULT_KERNEL_LINES_PATH = "config/kernel-lines.json";

export class KernelLineInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KernelLineInputError";
  }
}

export interface KernelLineInputOptions {
  /** Repository-relative registry path (tests may point at a fixture). */
  registryPath?: string;
  /** Repository-relative file reader; defaults to `readFileSync` under cwd. */
  readFile?: (relativePath: string) => string;
}

function reader(options: KernelLineInputOptions): (relativePath: string) => string {
  return options.readFile ?? ((relativePath) => readFileSync(resolve(process.cwd(), relativePath), "utf8"));
}

/**
 * Read and validate the kernel-line registry. A source plan may only dispatch
 * when its kernel line is modelled here; anything else stays a planner 409
 * instead of silently falling back to the ImageBuilder path.
 */
export function loadKernelLineRegistry(options: KernelLineInputOptions = {}): KernelLineRegistry {
  const registryPath = options.registryPath ?? DEFAULT_KERNEL_LINES_PATH;
  let raw: unknown;
  try {
    raw = JSON.parse(reader(options)(registryPath));
  } catch (error) {
    throw new KernelLineInputError(
      `kernel-line registry ${registryPath} is not readable JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    return parseKernelLineRegistry(raw);
  } catch (error) {
    throw new KernelLineInputError(error instanceof Error ? error.message : String(error));
  }
}

/** Resolve a kernel line that can actually run a source build. */
export function findSourceKernelLine(registry: KernelLineRegistry, id: string): SourceKernelLine {
  const line = registry.lines.find((candidate) => candidate.id === id);
  if (!line) {
    const known = registry.lines.map((candidate) => candidate.id).join(", ");
    throw new KernelLineInputError(
      `kernel line "${id}" is not modelled in ${DEFAULT_KERNEL_LINES_PATH}; modelled lines: ${known}`,
    );
  }
  if (line.engine !== "source") {
    throw new KernelLineInputError(
      `kernel line "${id}" uses the imagebuilder engine in ${DEFAULT_KERNEL_LINES_PATH}; a source build needs a source line`,
    );
  }
  return line;
}

/** Read the pinned `.config` fragment the kernel line declares. */
export function loadKernelConfigFragment(
  line: SourceKernelLine,
  options: KernelLineInputOptions = {},
): string {
  const fragmentPath = line.source.configFragment;
  try {
    return reader(options)(fragmentPath);
  } catch (error) {
    throw new KernelLineInputError(
      `kernel config fragment ${fragmentPath} for line "${line.id}" is not readable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
