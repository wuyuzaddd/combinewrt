import type { BuildPlanV2 } from "../domain/build-plan";
import type { KernelVersion } from "../domain/types";
import { KERNEL_LINE_VERSIONS } from "../domain/types";
import type { ImageVariant } from "../domain/types";

/**
 * Kernel-line registry and the pure source-build recipe generator.
 *
 * Everything in this module is deterministic and free of I/O: the workflow
 * receives the recipe as a JSON payload, so the same plan always produces the
 * same `.config`, `feeds.conf` and package list. Anything executable belongs in
 * the workflow, never in the recipe.
 */

export interface KernelFeedPin {
  name: string;
  repo: string;
  ref: string;
}

export interface SourceKernelSource {
  repo: string;
  ref: string;
  branch: string;
  expectedKernel: string;
  kernelVersionFile: string;
  configFragment: string;
  cacheKey: string;
  feeds: KernelFeedPin[];
  patches: string[];
}

export interface SourceKernelLine {
  id: string;
  version: KernelVersion;
  engine: "source";
  experimental: boolean;
  source: SourceKernelSource;
}

export interface ImageBuilderKernelLine {
  id: string;
  version: KernelVersion;
  engine: "imagebuilder";
  experimental: boolean;
}

export type KernelLineRecipe = SourceKernelLine | ImageBuilderKernelLine;

export interface KernelLineRegistry {
  schemaVersion: 1;
  unwantedVersions: string[];
  lines: KernelLineRecipe[];
}

const COMMIT_RE = /^[0-9a-f]{40}$/;
const GITHUB_REPO_RE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/;
const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const RELATIVE_PATH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const CACHE_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const FEED_NAME_RE = /^[a-z0-9][a-z0-9_-]*$/;
const PACKAGE_RE = /^[A-Za-z0-9][A-Za-z0-9+._-]*$/;
const ARTIFACT_NAME_RE = /^immortalwrt-[A-Za-z0-9._-]+\.(?:img\.gz|tar\.gz|vmdk|qcow2)$/;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function isCommit(value: unknown): value is string {
  return typeof value === "string" && COMMIT_RE.test(value);
}

function isRelativePath(value: unknown): value is string {
  return typeof value === "string" && RELATIVE_PATH_RE.test(value) && !value.split("/").includes("..");
}

/**
 * Check the checked-in registry. Returns every violation instead of throwing,
 * so the CLI can print an actionable list.
 */
export function validateKernelLineRegistry(raw: unknown): string[] {
  const registry = asRecord(raw);
  if (!registry) return ["registry must be a JSON object"];

  const violations: string[] = [];
  if (registry.schemaVersion !== 1) {
    violations.push(`schemaVersion must be 1 (got ${JSON.stringify(registry.schemaVersion)})`);
  }

  const unwanted = Array.isArray(registry.unwantedVersions) ? registry.unwantedVersions : null;
  if (!unwanted || unwanted.some((version) => typeof version !== "string")) {
    violations.push("unwantedVersions must be an array of strings");
  } else {
    for (const required of ["5.15", "6.1"]) {
      if (!unwanted.includes(required)) violations.push(`unwantedVersions must list "${required}"`);
    }
  }

  const lines = Array.isArray(registry.lines) ? registry.lines : null;
  if (!lines || lines.length === 0) {
    violations.push("lines must be a non-empty array");
    return violations;
  }

  const unwantedList = unwanted ?? [];
  const seenIds = new Set<string>();
  const seenVersions = new Set<string>();

  for (const [index, candidate] of lines.entries()) {
    const line = asRecord(candidate);
    if (!line) {
      violations.push(`lines[${index}] must be an object`);
      continue;
    }

    const id = typeof line.id === "string" ? line.id : "";
    const version = typeof line.version === "string" ? line.version : "";
    const engine = typeof line.engine === "string" ? line.engine : "";
    const label = id || version || `lines[${index}]`;

    if (!id) violations.push(`lines[${index}] is missing its id`);
    if (!KERNEL_LINE_VERSIONS.includes(version as KernelVersion)) {
      if (unwantedList.includes(version)) {
        violations.push(`kernel line ${version} is unwanted; only ${KERNEL_LINE_VERSIONS.join(", ")} are supported`);
      } else {
        violations.push(`kernel line ${label} has unsupported version ${JSON.stringify(line.version)}`);
      }
    }
    if (typeof line.experimental !== "boolean") violations.push(`kernel line ${label} must declare experimental as a boolean`);
    if (engine !== "source" && engine !== "imagebuilder") {
      violations.push(`kernel line ${label} engine must be "source" or "imagebuilder" (got ${JSON.stringify(line.engine)})`);
    }
    if (id && version && id !== version) {
      violations.push(`kernel line ${label} id must equal its version (got id "${id}", version "${version}")`);
    }
    if (id && seenIds.has(id)) violations.push(`duplicate kernel line ${label} declared more than once`);
    seenIds.add(id);
    if (version) seenVersions.add(version);

    if (version === "6.12" && engine !== "imagebuilder") {
      violations.push(`kernel line 6.12 must use the imagebuilder engine (got ${JSON.stringify(engine)})`);
    }
    if ((version === "6.6" || version === "6.18") && engine !== "source") {
      violations.push(`kernel line ${version} must use the source engine (got ${JSON.stringify(engine)})`);
    }

    const source = asRecord(line.source);
    if (engine === "imagebuilder") {
      if (line.source !== undefined) {
        violations.push(`imagebuilder kernel line "${label}" must not declare source`);
      }
      continue;
    }
    if (engine !== "source") continue;
    if (!source) {
      violations.push(`source kernel line "${label}" must declare source`);
      continue;
    }

    if (!isCommit(source.ref)) {
      violations.push(`kernel line ${label} ref must be a 40-character lowercase commit sha (got ${JSON.stringify(source.ref)})`);
    }
    if (typeof source.repo !== "string" || !GITHUB_REPO_RE.test(source.repo)) {
      violations.push(`kernel line ${label} repo must be a github.com https clone URL ending in .git`);
    }
    if (typeof source.branch !== "string" || !BRANCH_RE.test(source.branch)) {
      violations.push(`kernel line ${label} branch must be a plain git branch name`);
    }
    if (typeof source.expectedKernel !== "string" || !source.expectedKernel.startsWith(`${version}.`)) {
      violations.push(`kernel line ${label} expectedKernel must look like ${version}.<patch>`);
    }
    if (!isRelativePath(source.kernelVersionFile)) {
      violations.push(`kernel line ${label} kernelVersionFile must be a repository-relative path`);
    }
    if (
      typeof source.configFragment !== "string" ||
      !source.configFragment.startsWith("config/kernel/") ||
      !source.configFragment.endsWith(".config")
    ) {
      violations.push(`kernel line ${label} configFragment must live under config/kernel/ and end in .config`);
    }
    if (typeof source.cacheKey !== "string" || !CACHE_KEY_RE.test(source.cacheKey)) {
      violations.push(`kernel line ${label} cacheKey must be a simple cache-safe token`);
    }
    if (source.patches !== undefined) {
      if (!Array.isArray(source.patches) || source.patches.some((patch) => !isRelativePath(patch))) {
        violations.push(`kernel line ${label} patches must be repository-relative paths`);
      }
    }

    const feeds = Array.isArray(source.feeds) ? source.feeds : null;
    if (!feeds || feeds.length === 0) {
      violations.push(`kernel line ${label} must pin at least one feed`);
      continue;
    }
    const feedNames = new Set<string>();
    for (const [feedIndex, feedCandidate] of feeds.entries()) {
      const feed = asRecord(feedCandidate);
      if (!feed) {
        violations.push(`kernel line ${label} feeds[${feedIndex}] must be an object`);
        continue;
      }
      const feedName = typeof feed.name === "string" ? feed.name : "";
      const feedLabel = feedName || `feeds[${feedIndex}]`;
      if (!FEED_NAME_RE.test(feedName)) violations.push(`kernel line ${label} feed "${feedLabel}" name is invalid`);
      if (feedNames.has(feedName)) violations.push(`kernel line ${label} feed "${feedLabel}" is declared more than once`);
      feedNames.add(feedName);
      if (typeof feed.repo !== "string" || !GITHUB_REPO_RE.test(feed.repo)) {
        violations.push(`kernel line ${label} feed "${feedLabel}" repo must be a github.com https clone URL ending in .git`);
      }
      if (!isCommit(feed.ref)) {
        violations.push(`kernel line ${label} feed "${feedLabel}" ref must be a 40-character lowercase commit sha`);
      }
    }
  }

  for (const version of KERNEL_LINE_VERSIONS) {
    if (!seenVersions.has(version)) violations.push(`kernel line ${version} is missing from config/kernel-lines.json`);
  }

  return violations;
}

export function parseKernelLineRegistry(raw: unknown): KernelLineRegistry {
  const violations = validateKernelLineRegistry(raw);
  if (violations.length > 0) {
    throw new Error(`kernel-lines: invalid registry:\n${violations.map((violation) => `  - ${violation}`).join("\n")}`);
  }
  return raw as KernelLineRegistry;
}

export interface SourceModeFragment {
  id: string;
  content: string;
}

export interface SourceRecipeInput {
  plan: BuildPlanV2;
  line: SourceKernelLine;
  fragment: string;
  modeFragments?: readonly SourceModeFragment[];
  now?: Date;
}

export interface SourceRecipeMetadata {
  schemaVersion: 1;
  generatedAt: string;
  baseVersion: string;
  channel: string;
  targetId: string;
  profileId: string;
  kernelLine: { id: string; version: KernelVersion; engine: "source"; expectedKernel: string };
  kernelVersionFile: string;
  source: { repo: string; ref: string; branch: string };
  imageVariant: ImageVariant;
  artifactName: string;
  imageGlob: string;
  packages: string[];
  feeds: KernelFeedPin[];
  patches: string[];
  cacheKey: string;
}

export interface SourceRecipe {
  schemaVersion: 1;
  engine: "source";
  kernelLineId: string;
  kernelVersion: KernelVersion;
  expectedKernel: string;
  kernelVersionFile: string;
  source: { repo: string; ref: string; branch: string };
  cacheKey: string;
  targetId: string;
  profileId: string;
  baseVersion: string;
  imageVariant: ImageVariant;
  artifactName: string;
  imageGlob: string;
  config: string;
  feedsConf: string;
  packages: string[];
  configChecks: string[];
  profileChecks: string[];
  metadata: SourceRecipeMetadata;
}

export class SourceRecipeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceRecipeError";
  }
}

function assertInput(condition: boolean, message: string): void {
  if (!condition) throw new SourceRecipeError(message);
}

function configKey(line: string): string | null {
  const set = /^([A-Z][A-Z0-9_]*)=/.exec(line);
  if (set) return set[1]!;
  const unset = /^# (CONFIG_[A-Z0-9_]+) is not set$/.exec(line);
  if (unset) return unset[1]!;
  return null;
}

function mergeConfigLines(blocks: readonly string[][]): string[] {
  const merged: string[] = [];
  const indexByKey = new Map<string, number>();
  for (const block of blocks) {
    for (const raw of block) {
      const line = raw.trimEnd();
      if (line.trim() === "") continue;
      const key = configKey(line);
      if (key === null) {
        merged.push(line);
        continue;
      }
      const existing = indexByKey.get(key);
      if (existing === undefined) {
        indexByKey.set(key, merged.length);
        merged.push(line);
      } else {
        merged[existing] = line;
      }
    }
  }
  return merged;
}

function variantLines(variant: ImageVariant): string[] {
  const lines: string[] = ["CONFIG_TARGET_IMAGES_GZIP=y"];
  if (variant.filesystem === "squashfs") {
    lines.push("CONFIG_TARGET_ROOTFS_SQUASHFS=y", "# CONFIG_TARGET_ROOTFS_EXT4FS is not set");
  } else {
    lines.push("CONFIG_TARGET_ROOTFS_EXT4FS=y", "# CONFIG_TARGET_ROOTFS_SQUASHFS is not set");
  }

  const bootsGrub = variant.artifact === "combined" || variant.artifact === "vmdk" || variant.artifact === "qcow2";
  if (bootsGrub && variant.boot === "efi") {
    lines.push("CONFIG_GRUB_EFI_IMAGES=y", "# CONFIG_GRUB_IMAGES is not set");
  } else if (bootsGrub) {
    lines.push("CONFIG_GRUB_IMAGES=y", "# CONFIG_GRUB_EFI_IMAGES is not set");
  } else {
    lines.push("# CONFIG_GRUB_IMAGES is not set", "# CONFIG_GRUB_EFI_IMAGES is not set");
  }

  lines.push(
    variant.artifact === "vmdk" ? "CONFIG_VMDK_IMAGES=y" : "# CONFIG_VMDK_IMAGES is not set",
    variant.artifact === "qcow2" ? "CONFIG_QCOW2_IMAGES=y" : "# CONFIG_QCOW2_IMAGES is not set",
    "# CONFIG_VDI_IMAGES is not set",
    "# CONFIG_VHDX_IMAGES is not set",
    "# CONFIG_ISO_IMAGES is not set",
  );
  return lines;
}

function imageGlob(variant: ImageVariant): string {
  const filesystem = variant.filesystem;
  const bootSuffix = variant.boot === "efi" ? "-efi" : "";
  switch (variant.artifact) {
    case "combined":
      return `*-${filesystem}-combined${bootSuffix}.img.gz`;
    case "rootfs":
      return "*-rootfs.img.gz";
    case "vmdk":
      return `*-${filesystem}-combined${bootSuffix}.vmdk`;
    case "qcow2":
      return `*-${filesystem}-combined${bootSuffix}.qcow2`;
    default:
      throw new SourceRecipeError(`artifact "${variant.artifact}" is not produced by source builds`);
  }
}

function profileChecksFor(targetId: string, profileId: string): string[] {
  // `scripts/target-metadata.pl` builds the "Target Profile" choice from the
  // image `Device/` definitions, so the profile symbol is
  // `TARGET_<conf>_DEVICE_<device>`. The 24.10 tree also still answers to the
  // older human profile symbol, and buildbot-style configs select the
  // `TARGET_DEVICE_*` menu entries through TARGET_MULTI_PROFILE; accept any of
  // them and let `make defconfig` decide.
  const conf = targetId.replaceAll("/", "_");
  const checks = [
    `CONFIG_TARGET_${conf}_DEVICE_${profileId}=y`,
    `CONFIG_TARGET_DEVICE_${conf}_DEVICE_${profileId}=y`,
    `CONFIG_TARGET_${conf}_${profileId}=y`,
  ];
  if (targetId === "x86/64" && profileId === "generic") {
    checks.push("CONFIG_TARGET_x86_64_Generic=y");
  }
  return checks;
}

/**
 * Turn a V2 plan plus a pinned kernel line into the exact, reviewable input of a
 * source build. Throws `SourceRecipeError` for anything the controlled path does
 * not cover; no shell, no network, no filesystem.
 */
export function generateSourceRecipe(input: SourceRecipeInput): SourceRecipe {
  const { plan, line, fragment, now } = input;
  const context = `kernel line "${line.id}"`;

  assertInput(
    line.engine === "source",
    `generateSourceRecipe requires a source kernel line; "${line.id}" uses the imagebuilder engine.`,
  );
  assertInput(
    plan.schemaVersion === 2,
    `${context}: source builds require a schemaVersion 2 build plan (the V1 imagebuilder plan cannot be converted).`,
  );
  assertInput(
    plan.engine === "source",
    `${context}: plan engine is "${plan.engine}", but a source build needs the source engine.`,
  );
  assertInput(
    plan.kernelLine.engine === "source",
    `${context}: plan kernel line "${plan.kernelLine.id}" does not use the source engine.`,
  );
  assertInput(
    plan.kernelLine.id === line.id,
    `plan kernel line "${plan.kernelLine.id}" does not match recipe kernel line "${line.id}".`,
  );
  assertInput(
    plan.target.id === "x86/64",
    `${context}: source builds are limited to target "x86/64"; plan targets "${plan.target.id}".`,
  );
  assertInput(
    fragment.trim().length > 0,
    `${context}: config fragment ${line.source.configFragment} is empty.`,
  );

  const allowedArtifacts = new Set(["combined", "rootfs", "vmdk", "qcow2"]);
  assertInput(
    allowedArtifacts.has(plan.imageVariant.artifact),
    `${context}: artifact "${plan.imageVariant.artifact}" is not supported by source builds (emmc has no source recipe).`,
  );
  assertInput(
    ARTIFACT_NAME_RE.test(plan.artifactName),
    `${context}: artifactName "${plan.artifactName}" is not a safe combinewrt artifact name.`,
  );

  const packages = [...new Set(plan.topLevelPackages)];
  for (const name of packages) {
    assertInput(PACKAGE_RE.test(name), `${context}: package "${name}" is not a safe package name.`);
  }

  const fragmentsById = new Map<string, string>();
  for (const modeFragment of input.modeFragments ?? []) {
    fragmentsById.set(modeFragment.id, modeFragment.content);
  }
  for (const mode of plan.overlays) {
    assertInput(
      fragmentsById.has(mode.id),
      `${context}: mode "${mode.id}" has no config fragment; add one to modeFragments before generating.`,
    );
  }

  const [board, subtarget] = plan.target.id.split("/") as [string, string];
  const boardSymbol = board.replaceAll("-", "_");
  const targetSymbol = `${boardSymbol}_${subtarget.replaceAll("-", "_")}`;

  const header = [
    `# Generated by combinewrt source.ts for kernel line ${line.id} (source build).`,
    `# Source: ${line.source.repo}@${line.source.ref} (${line.source.branch})`,
    `# Expected kernel: ${line.source.expectedKernel}. Regenerate from the build plan; do not edit by hand.`,
  ];
  const targetBlock = [
    `CONFIG_TARGET_${boardSymbol}=y`,
    `CONFIG_TARGET_${targetSymbol}=y`,
    // The workflow persists ~/.ccache between runs; without this option the
    // compiler cache stays unused.
    "CONFIG_CCACHE=y",
  ];
  const fragmentBlock = fragment.split("\n");
  const modeBlocks: string[][] = [];
  for (const mode of plan.overlays) {
    modeBlocks.push([`# mode: ${mode.id}`, ...(fragmentsById.get(mode.id) ?? "").split("\n")]);
  }
  const packageBlock = packages.map((name) => `CONFIG_PACKAGE_${name}=y`);

  const config = [
    ...mergeConfigLines([header, targetBlock, fragmentBlock, ...modeBlocks, variantLines(plan.imageVariant), packageBlock]),
    "",
  ].join("\n");

  const feedsConf = `${line.source.feeds.map((feed) => `src-git ${feed.name} ${feed.repo}^${feed.ref}`).join("\n")}\n`;

  const configChecks = [
    `CONFIG_TARGET_${boardSymbol}=y`,
    `CONFIG_TARGET_${targetSymbol}=y`,
    plan.imageVariant.filesystem === "squashfs" ? "CONFIG_TARGET_ROOTFS_SQUASHFS=y" : "CONFIG_TARGET_ROOTFS_EXT4FS=y",
    ...(plan.imageVariant.artifact === "vmdk" ? ["CONFIG_VMDK_IMAGES=y"] : []),
    ...(plan.imageVariant.artifact === "qcow2" ? ["CONFIG_QCOW2_IMAGES=y"] : []),
    ...(plan.imageVariant.artifact === "combined" && plan.imageVariant.boot === "efi" ? ["CONFIG_GRUB_EFI_IMAGES=y"] : []),
    ...(plan.imageVariant.artifact === "combined" && plan.imageVariant.boot === "legacy" ? ["CONFIG_GRUB_IMAGES=y"] : []),
    ...packages.map((name) => `CONFIG_PACKAGE_${name}=y`),
  ];

  const glob = imageGlob(plan.imageVariant);
  const generatedAt = (now ?? new Date()).toISOString();

  return {
    schemaVersion: 1,
    engine: "source",
    kernelLineId: line.id,
    kernelVersion: line.version,
    expectedKernel: line.source.expectedKernel,
    kernelVersionFile: line.source.kernelVersionFile,
    source: { repo: line.source.repo, ref: line.source.ref, branch: line.source.branch },
    cacheKey: line.source.cacheKey,
    targetId: plan.target.id,
    profileId: plan.profileId,
    baseVersion: plan.baseVersion,
    imageVariant: plan.imageVariant,
    artifactName: plan.artifactName,
    imageGlob: glob,
    config,
    feedsConf,
    packages,
    configChecks,
    profileChecks: profileChecksFor(plan.target.id, plan.profileId),
    metadata: {
      schemaVersion: 1,
      generatedAt,
      baseVersion: plan.baseVersion,
      channel: plan.channel,
      targetId: plan.target.id,
      profileId: plan.profileId,
      kernelLine: { id: line.id, version: line.version, engine: "source", expectedKernel: line.source.expectedKernel },
      kernelVersionFile: line.source.kernelVersionFile,
      source: { repo: line.source.repo, ref: line.source.ref, branch: line.source.branch },
      imageVariant: plan.imageVariant,
      artifactName: plan.artifactName,
      imageGlob: glob,
      packages,
      feeds: line.source.feeds,
      patches: line.source.patches ?? [],
      cacheKey: line.source.cacheKey,
    },
  };
}
