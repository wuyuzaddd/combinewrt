import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ImageFormatId } from "../catalog/types";
import type { BuildPlanV2 } from "../domain/build-plan";
import type { ImageVariant } from "../domain/types";
import {
  artifactNameV1,
  artifactNameV2,
  imageTypeForPlan,
  imageTypeForVariant,
  variantForImageType,
} from "./artifact-name";
import type { BuildFormInputV2 } from "./types";

const BASE = { baseVersion: "25.12.2", profileId: "generic" } as const;
const PREFIX = "immortalwrt-25.12.2-x86-64-generic";

/** The three V1 fixture names every legacy plan and workflow branch still reads. */
const V1_FIXTURES: Array<[ImageFormatId, string]> = [
  ["ext4-efi", `${PREFIX}-ext4-combined-efi.img.gz`],
  ["squashfs-efi", `${PREFIX}-squashfs-combined-efi.img.gz`],
  ["rootfs-tar", `${PREFIX}-targz-rootfs.tar.gz`],
];

function v2Name(imageVariant: ImageVariant): string {
  return artifactNameV2({ ...BASE, targetId: "x86/64", imageVariant });
}

describe("artifactNameV1", () => {
  it("keeps the V1 fixture names byte-identical", () => {
    for (const [imageType, expected] of V1_FIXTURES) {
      expect(artifactNameV1(imageType, BASE)).toBe(expected);
    }
  });

  it("rejects an unknown image type instead of guessing a name", () => {
    expect(() => artifactNameV1("vmdk" as ImageFormatId, BASE)).toThrow(/unknown image type/);
  });
});

describe("V1/V2 name parity", () => {
  it("names every V1 format exactly like the equivalent V2 variant", () => {
    for (const [imageType, expected] of V1_FIXTURES) {
      expect(artifactNameV1(imageType, BASE)).toBe(expected);
      expect(v2Name(variantForImageType(imageType))).toBe(expected);
    }
  });

  it("maps the V2 variant back to the same V1 format", () => {
    for (const [imageType] of V1_FIXTURES) {
      expect(imageTypeForVariant(variantForImageType(imageType))).toBe(imageType);
    }
  });
});

describe("artifactNameV2", () => {
  it("covers the eight accepted boot/filesystem/artifact combinations", () => {
    const expected: Array<[ImageVariant, string]> = [
      [{ boot: "efi", filesystem: "ext4", artifact: "combined" }, `${PREFIX}-ext4-combined-efi.img.gz`],
      [{ boot: "efi", filesystem: "ext4", artifact: "rootfs" }, `${PREFIX}-targz-rootfs.tar.gz`],
      [{ boot: "efi", filesystem: "squashfs", artifact: "combined" }, `${PREFIX}-squashfs-combined-efi.img.gz`],
      [{ boot: "efi", filesystem: "squashfs", artifact: "rootfs" }, `${PREFIX}-targz-rootfs.tar.gz`],
      [{ boot: "legacy", filesystem: "ext4", artifact: "combined" }, `${PREFIX}-ext4-combined.img.gz`],
      [{ boot: "legacy", filesystem: "ext4", artifact: "rootfs" }, `${PREFIX}-targz-rootfs.tar.gz`],
      [{ boot: "legacy", filesystem: "squashfs", artifact: "combined" }, `${PREFIX}-squashfs-combined.img.gz`],
      [{ boot: "legacy", filesystem: "squashfs", artifact: "rootfs" }, `${PREFIX}-targz-rootfs.tar.gz`],
    ];
    expect(expected).toHaveLength(8);
    for (const [variant, name] of expected) {
      expect(v2Name(variant)).toBe(name);
    }
  });

  it("gives every non-rootfs combination a distinct name", () => {
    const combined = new Set([
      v2Name({ boot: "efi", filesystem: "ext4", artifact: "combined" }),
      v2Name({ boot: "efi", filesystem: "squashfs", artifact: "combined" }),
      v2Name({ boot: "legacy", filesystem: "ext4", artifact: "combined" }),
      v2Name({ boot: "legacy", filesystem: "squashfs", artifact: "combined" }),
    ]);
    expect(combined.size).toBe(4);

    const rootfs = new Set([
      v2Name({ boot: "efi", filesystem: "ext4", artifact: "rootfs" }),
      v2Name({ boot: "efi", filesystem: "squashfs", artifact: "rootfs" }),
      v2Name({ boot: "legacy", filesystem: "ext4", artifact: "rootfs" }),
      v2Name({ boot: "legacy", filesystem: "squashfs", artifact: "rootfs" }),
    ]);
    expect(rootfs.size).toBe(1);
  });
});

describe("imageTypeForPlan", () => {
  it("reads the stored V1 field and derives the V2 equivalent", () => {
    const v1 = { imageType: "squashfs-efi" } as { imageType: ImageFormatId };
    expect(imageTypeForPlan(v1 as never)).toBe("squashfs-efi");

    const v2 = { schemaVersion: 2, imageVariant: { boot: "legacy", filesystem: "ext4", artifact: "combined" } };
    expect(imageTypeForPlan(v2 as never)).toBe("ext4-efi");
  });
});

describe("V2 write paths", () => {
  // ADR 0009 ruling 4: the type system, not a comment, is the guard. If a V1
  // image field comes back to the V2 plan/form types, these fail `typecheck`.
  type HasImageType<T> = "imageType" extends keyof T ? true : false;
  const planHasImageType: HasImageType<BuildPlanV2> = false;
  const configHasImageType: HasImageType<NonNullable<BuildPlanV2["config"]>> = false;
  const formHasImageType: HasImageType<BuildFormInputV2> = false;

  it("keeps ImageFormatId off the V2 plan, its config and the V2 form", () => {
    expect([planHasImageType, configHasImageType, formHasImageType]).toEqual([false, false, false]);
  });

  it("no V2 write module names the V1 image type", () => {
    const planV2 = readFileSync(fileURLToPath(new URL("./plan-v2.ts", import.meta.url)), "utf8");
    expect(planV2).not.toMatch(/imageType|ImageFormatId/);
  });

  it("keeps the workflow's V1-compatible imageType check and never reads it from composition.v2", () => {
    const workflow = readFileSync(
      fileURLToPath(new URL("../../../build-workflow/build.yml", import.meta.url)),
      "utf8",
    );
    expect(workflow).toMatch(/for field in artifactName imageType profileId baseVersion/);
    expect(workflow).not.toMatch(/composition\.v2\.imageType/);
  });
});
