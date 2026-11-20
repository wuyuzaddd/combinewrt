import type { GeneratedFile } from "./types";

/**
 * Ticket 05: one rule for the `plan.files[]` overlay, shared by the dispatch
 * path and both build engines.
 *
 * A generated file is written into the build tree before `make image`, so a bad
 * entry is arbitrary file write as the CI runner. The rule is deliberately
 * small:
 *
 * - the path is relative to the build tree and lives inside the `files/`
 *   overlay (paths like `/etc/shadow` or `../../etc/passwd` are refused);
 * - the path never traverses with `..`;
 * - the mode is one of the two the planner ever emits: 0644 for configuration
 *   files and 0755 for uci-defaults scripts.
 *
 * The executable copy of this rule is `build-workflow/check-files.sh`, which
 * both workflow engines source; `src/lib/build/workflow-yaml.test.ts` keeps the
 * two copies in sync and proves each workflow calls it.
 */
export const ALLOWED_GENERATED_FILE_MODES = [0o644, 0o755] as const;

const GENERATED_FILE_PATH_RE = /^files\/[A-Za-z0-9][A-Za-z0-9._/-]*$/;

export function isAllowedGeneratedFileMode(mode: unknown): mode is number {
  return typeof mode === "number" && (ALLOWED_GENERATED_FILE_MODES as readonly number[]).includes(mode);
}

export function isSafeGeneratedFilePath(path: unknown): path is string {
  return typeof path === "string" && GENERATED_FILE_PATH_RE.test(path) && !path.includes("..");
}

/**
 * Return the first rule violation for one file, or `null` when it is safe.
 * Callers throw their own error type, so dispatch and the recipe generator keep
 * their existing error classes while sharing the predicate.
 */
export function generatedFileViolation(file: Pick<GeneratedFile, "path" | "mode">): string | null {
  if (!isSafeGeneratedFilePath(file.path)) {
    return `generated file path "${String(file.path)}" is not a safe files/ overlay path`;
  }
  if (!isAllowedGeneratedFileMode(file.mode)) {
    return `generated file "${file.path}" has a mode outside 0644/0755 (got ${String(file.mode)})`;
  }
  return null;
}

export function generatedFileViolations(
  files: readonly Pick<GeneratedFile, "path" | "mode">[] | null | undefined,
): string[] {
  const violations: string[] = [];
  for (const file of files ?? []) {
    const violation = generatedFileViolation(file);
    if (violation) violations.push(violation);
  }
  return violations;
}

export class GeneratedFileRuleError extends Error {
  constructor(violations: readonly string[]) {
    super(`unsafe plan files:\n${violations.map((violation) => `  - ${violation}`).join("\n")}`);
    this.name = "GeneratedFileRuleError";
  }
}

/** Throw before a plan crosses a trust boundary (the dispatch call). */
export function assertSafeGeneratedFiles(
  files: readonly Pick<GeneratedFile, "path" | "mode">[] | null | undefined,
): void {
  const violations = generatedFileViolations(files);
  if (violations.length > 0) throw new GeneratedFileRuleError(violations);
}
