import type { CatalogProfile } from "../catalog/types";
import type { BuildPlanV1 } from "../domain/build-plan";
import type { ImageVariant } from "../domain/types";
import { imageTypeForVariant } from "./artifact-name";
import { createBuildPlan, type PlanContext } from "./plan";
import type { BuildConfig, BuildConfigV2, BuildFormInputV2 } from "./types";

/**
 * V1-only compatibility bridge (ADR 0009 ruling 4).
 *
 * The V2 composer reuses the V1 resolver for package resolution, compliance,
 * downloads and UCI output, and that resolver is modelled in terms of
 * `ImageFormatId`. Everything that has to name the V1 image type lives here, so
 * the V2 write paths (`plan-v2.ts`, artifact naming, the V2 payload) never see
 * an `ImageFormatId`. This module is a read/adaptation path, not a writer.
 */

/** V1 base-plan fields a V2 plan reuses, minus every V1-only image field. */
export type V2CompatibleBasePlan = Omit<BuildPlanV1, "schemaVersion" | "imageType" | "config"> & {
  config?: BuildConfigV2;
};

export interface ComposeV1BasePlanInput {
  /** Package list already filtered/expanded by the V2 composer. */
  form: BuildFormInputV2;
  imageVariant: ImageVariant;
  profile: { id: string; title: string };
  /** Active snapshot profiles, used to build the V1 catalog profile. */
  catalogProfiles: readonly CatalogProfile[];
  context: Omit<PlanContext, "profile">;
}

/**
 * The V1 catalog profile a V2 build presents to the V1 resolver. A variant the
 * catalog does not list is added first so the V1 composer's format check keeps
 * accepting it; the V1 catalog only models x86/64.
 */
function catalogProfileForVariant(
  catalogProfile: CatalogProfile | undefined,
  profile: { id: string; title: string },
  imageType: ReturnType<typeof imageTypeForVariant>,
): CatalogProfile {
  if (!catalogProfile) {
    return { id: profile.id, title: profile.title, formats: [imageType], imageCount: 0 };
  }
  return {
    ...catalogProfile,
    formats: catalogProfile.formats.includes(imageType)
      ? catalogProfile.formats
      : [imageType, ...catalogProfile.formats],
  };
}

/** Drop the V1-only `imageType` a V2 plan's config must not carry. */
function stripImageType(config: BuildConfig): BuildConfigV2 {
  const { imageType, ...rest } = config;
  void imageType;
  return rest;
}

export async function composeV1BasePlan(input: ComposeV1BasePlanInput): Promise<V2CompatibleBasePlan> {
  const imageType = imageTypeForVariant(input.imageVariant);
  const profile = catalogProfileForVariant(
    input.catalogProfiles.find((item) => item.id === input.profile.id),
    input.profile,
    imageType,
  );

  const plan = (await createBuildPlan(
    { ...input.form, imageType, removePackages: [] },
    { ...input.context, profile },
  )) as BuildPlanV1;

  const { imageType: v1OnlyImageType, config, ...rest } = plan;
  void v1OnlyImageType;
  return {
    ...rest,
    ...(config ? { config: stripImageType(config) } : {}),
  };
}
