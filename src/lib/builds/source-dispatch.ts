import { loadModeDeclarations } from "../build/modes";
import {
  findSourceKernelLine,
  loadKernelConfigFragment,
  loadKernelLineRegistry,
  type KernelLineInputOptions,
} from "../build/kernel-lines";
import { generateSourceRecipe, type KernelLineRegistry, type SourceModeFragment, type SourceRecipe } from "../build/source";
import type { BuildPlanV2 } from "../domain/build-plan";

/**
 * The `client_payload` of a `combinewrt-source-build` repository_dispatch
 * event. `repository_dispatch.client_payload` may have at most ten top-level
 * properties (spec:108), so only the build identity stays at the top level and
 * the whole recipe travels nested under `composition`, the same shape the
 * ImageBuilder payload uses. The workflow normalises it back to a flat recipe
 * before it builds.
 */
export interface SourceDispatchPayload {
  buildId: string;
  /** Payload shape version (the recipe's own schemaVersion lives in `composition`). */
  schemaVersion: 2;
  engine: "source";
  baseVersion: string;
  profileId: string;
  artifactName: string;
  composition: SourceRecipe;
}

export function buildSourceDispatchPayload(recipe: SourceRecipe, buildId: string): SourceDispatchPayload {
  return {
    buildId,
    schemaVersion: 2,
    engine: "source",
    baseVersion: recipe.baseVersion,
    profileId: recipe.profileId,
    artifactName: recipe.artifactName,
    composition: recipe,
  };
}

export interface SourceRecipeInputs extends KernelLineInputOptions {
  now?: Date;
  /** Pre-loaded registry (tests can inject a fixture instead of the file). */
  registry?: KernelLineRegistry;
}

/**
 * Assemble the source-build recipe for a plan from the checked-in kernel-line
 * registry, the pinned config fragment and the kernel fragments the plan's
 * modes contribute. Throws `KernelLineInputError` / `SourceRecipeError`; the
 * queue records those as a structured dispatch failure, never as a silent
 * ImageBuilder fallback.
 */
export function loadSourceRecipe(plan: BuildPlanV2, options: SourceRecipeInputs = {}): SourceRecipe {
  const registry = options.registry ?? loadKernelLineRegistry(options);
  const line = findSourceKernelLine(registry, plan.kernelLine.id);
  const fragment = loadKernelConfigFragment(line, options);
  const modeFragments = modeFragmentsFor(plan);

  return generateSourceRecipe({
    plan,
    line,
    fragment,
    modeFragments,
    now: options.now,
  });
}

function modeFragmentsFor(plan: BuildPlanV2): SourceModeFragment[] {
  if (plan.overlays.length === 0) return [];
  const declarations = loadModeDeclarations();
  return plan.overlays.map((mode) => {
    const declaration = declarations.find((candidate) => candidate.id === mode.id);
    // `generateSourceRecipe` asserts every overlay has a fragment entry; a mode
    // with no kernel config contributes an empty one, not a missing key.
    return { id: mode.id, content: (declaration?.kernelConfig ?? []).join("\n") };
  });
}
