import type { CatalogProfile, ImageFormatId } from "./types";

export interface ImageFormat {
  id: ImageFormatId;
  label: string;
  suffix: string;
}

export const IMAGE_FORMATS: readonly ImageFormat[] = [
  { id: "ext4-efi", label: "ext4 EFI", suffix: "-ext4-combined-efi.img.gz" },
  { id: "squashfs-efi", label: "squashfs EFI", suffix: "-squashfs-combined-efi.img.gz" },
  { id: "rootfs-tar", label: "rootfs.tar.gz", suffix: "-targz-rootfs.tar.gz" },
];

const LABELS: Record<ImageFormatId, string> = {
  "ext4-efi": "ext4 EFI",
  "squashfs-efi": "squashfs EFI",
  "rootfs-tar": "rootfs.tar.gz",
};

export function imageFormatLabel(id: ImageFormatId): string {
  return LABELS[id];
}

export function supportedImageFormatIds(images: Array<{ name?: unknown }>): ImageFormatId[] {
  return IMAGE_FORMATS.filter((format) =>
    images.some((image) => typeof image.name === "string" && image.name.endsWith(format.suffix)),
  ).map((format) => format.id);
}

export function parseProfiles(json: unknown): CatalogProfile[] {
  if (typeof json !== "object" || json === null) {
    throw new Error("profiles.json must be an object");
  }
  const data = json as { arch_packages?: unknown; profiles?: unknown };
  if (data.arch_packages !== "x86_64") {
    throw new Error(`profiles.json is for ${String(data.arch_packages)}, expected x86_64`);
  }
  if (typeof data.profiles !== "object" || data.profiles === null) {
    throw new Error("profiles.json has no profiles object");
  }

  const profiles: CatalogProfile[] = [];
  for (const [id, raw] of Object.entries(data.profiles as Record<string, unknown>)) {
    if (typeof raw !== "object" || raw === null) continue;
    const profile = raw as { titles?: unknown; images?: unknown };
    const titles = Array.isArray(profile.titles) ? profile.titles : [];
    const firstTitle = titles[0] as { vendor?: unknown; model?: unknown } | undefined;
    const title = [firstTitle?.vendor, firstTitle?.model].filter((part) => typeof part === "string").join(" ");
    const images = Array.isArray(profile.images) ? (profile.images as Array<{ name?: unknown }>) : [];
    profiles.push({
      id,
      title: title || id,
      formats: supportedImageFormatIds(images),
      imageCount: images.length,
    });
  }

  if (profiles.length === 0) {
    throw new Error("profiles.json contains no profiles");
  }

  profiles.sort((a, b) => a.id.localeCompare(b.id));
  return profiles;
}
