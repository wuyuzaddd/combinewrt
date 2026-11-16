/**
 * V2 domain model. These types are the shared vocabulary for build plans,
 * capability declarations and mode presets. V1 data is described by the same
 * shapes through defaults (x86/64 target, 6.12 kernel line, release channel).
 */

export type BaseChannel = "release" | "snapshot";

export interface Target {
  /** OpenWrt target/subtarget pair, e.g. "x86/64". */
  id: string;
  architecture: string;
  subtarget: string;
  title: string;
}

export interface DeviceProfile {
  targetId: string;
  id: string;
  title: string;
  capabilities: string[];
}

export type KernelVersion = "6.6" | "6.12" | "6.18";

export const KERNEL_LINE_VERSIONS: readonly KernelVersion[] = ["6.6", "6.12", "6.18"];

/** V2.0 release gate; 6.6 and 6.18 stay experimental until they pass the acceptance matrix. */
export const DEFAULT_KERNEL_LINE_ID: KernelVersion = "6.12";

export const EXPERIMENTAL_KERNEL_LINE_IDS: readonly KernelVersion[] = ["6.6", "6.18"];

export type BuildEngine = "imagebuilder" | "source";

export interface KernelLine {
  id: string;
  version: KernelVersion;
  engine: BuildEngine;
  /** Only meaningful for source builds; points at the checked-in kernel recipe. */
  sourceRecipeRef?: string;
}

export type BootMode = "efi" | "legacy";
export type FilesystemKind = "ext4" | "squashfs";
export type ArtifactKind = "combined" | "rootfs" | "vmdk" | "qcow2" | "emmc";

export interface ImageVariant {
  boot: BootMode;
  filesystem: FilesystemKind;
  artifact: ArtifactKind;
  overlaySizeMb?: number;
}

export type ModeLayer = "file/board" | "package/kernel" | "kernel/config";

export interface ModeRef {
  id: string;
  layer: ModeLayer;
  title?: string;
}

/**
 * Every V2 plan starts from exactly one base preset; overlays stack on top of
 * it (ADR 0006). Preset contents arrive with tickets 07/08; the plan schema
 * only carries the id so older plans stay readable.
 */
export type BasePresetId = "minimal" | "common" | "router-default";

export const BASE_PRESET_IDS: readonly BasePresetId[] = ["minimal", "common", "router-default"];

export const DEFAULT_TARGET_ID = "x86/64";

export const DEFAULT_TARGET: Target = {
  id: DEFAULT_TARGET_ID,
  architecture: "x86_64",
  subtarget: "generic",
  title: "x86/64 (generic)",
};
