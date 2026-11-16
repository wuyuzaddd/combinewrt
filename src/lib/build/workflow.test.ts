import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { EMPTY_SOURCE_PINS } from "../catalog/types";
import type { ImageVariant } from "../domain/types";
import { shellCommand } from "../image/postprocess";
import { mapImageVariant } from "../image/variants";
import { imageBuilderCommandForVariant } from "../builds/dispatch";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const workflowDir = join(root, "build-workflow");
const workflowPath = join(workflowDir, "build.yml");
const workflow = readFileSync(workflowPath, "utf8");

const canRunScripts =
  spawnSync("bash", ["-c", "command -v jq >/dev/null 2>&1"], { stdio: "ignore" }).status === 0;

// A green run must not hide a skipped contract test: say why the shell-script
// integration tests below are not running.
if (!canRunScripts) {
  console.warn(
    "[test] skipping variant-config.sh / fail.sh contract tests: bash + jq are unavailable in this environment",
  );
}

const BASE = { baseVersion: "25.12.2", targetId: "x86/64", profileId: "generic" } as const;

function planFor(variant: ImageVariant): string {
  const mapping = mapImageVariant({ ...BASE, variant });
  return JSON.stringify(
    {
      buildId: "workflow-test",
      baseVersion: BASE.baseVersion,
      feedCommit: "1198b107ed1b8505f16726156bf37790253e343f",
      profileId: BASE.profileId,
      imageType: mapping.imageType,
      packages: ["luci"],
      composition: {
        topLevelPackages: ["luci"],
        sourcePins: EMPTY_SOURCE_PINS,
        downloads: [],
        v2: {
          schemaVersion: 2,
          engine: "imagebuilder",
          target: { id: BASE.targetId, architecture: "x86_64", subtarget: "64" },
          kernelLine: { id: "linux-6.6", version: "6.6", engine: "imagebuilder" },
          imageVariant: mapping.variant,
          modes: [],
          products: mapping.products,
          makeTargets: mapping.makeTargets,
        },
      },
      files: [{ path: "files/etc/uci-defaults/99-combinewrt", content: "#!/bin/sh\nexit 0\n", mode: 493 }],
      artifactName: mapping.artifactName,
      imageBuilderCommand: "make -j$(nproc) image PROFILE=generic PACKAGES=\"luci\" FILES=files",
    },
    null,
    2,
  );
}

const tempDirs: string[] = [];
function planFile(variant: ImageVariant): string {
  const dir = mkdtempSync(join(tmpdir(), "combinewrt-workflow-"));
  tempDirs.push(dir);
  const file = join(dir, "plan.json");
  writeFileSync(file, planFor(variant));
  return file;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe("build-workflow/build.yml", () => {
  it("keeps both dispatch triggers and the run title the site looks up", () => {
    expect(workflow).toMatch(/^on:\n(?:.*\n)*?  repository_dispatch:/m);
    expect(workflow).toMatch(/^  workflow_dispatch:/m);
    expect(workflow).toContain("combinewrt-${{ github.event.client_payload.buildId || inputs.build_id }}");
    expect(workflow).toContain("plan_json:");
  });

  it("runs the steps in the order the site reports", () => {
    const steps = [...workflow.matchAll(/^      - name: (.+)$/gm)].map((match) => match[1]);
    expect(steps).toEqual([
      "Prepare plan",
      "Install tools",
      "Download ImageBuilder",
      "Configure ImageBuilder",
      "Download pinned third-party packages",
      "Write files",
      "Redact plan file",
      "Install feed key and preflight packages",
      "Build image",
      "Assert top-level packages",
      "Postprocess artifact",
      "Package artifact",
      "Upload artifact",
    ]);
  });

  it("applies the variant configuration to the ImageBuilder's own .config", () => {
    // The ImageBuilder "image" target unsets MAKEFLAGS, so CONFIG_* arguments
    // on the make command line are ignored; only .config takes effect.
    const step = workflow.slice(workflow.indexOf("Configure ImageBuilder"));
    expect(step).toContain("jq -r '.config[]' ../variant.json");
    expect(step).toContain('sed -i "s|^${key}=.*|${key}=${value}|" .config');
    expect(step).toContain('CONFIG_[A-Z0-9_]*) ;;');
    expect(step).toContain('if [ "$PLAN_SCHEMA" != "2" ]');
  });

  it("never prints plan file contents", () => {
    expect(workflow).not.toMatch(/^\s*cat plan\.json\s*$/m);
    expect(workflow).toContain("<redacted;");
  });

  it("references only scripts that exist in build-workflow/", () => {
    const referenced = new Set(
      [...workflow.matchAll(/\.github\/scripts\/([A-Za-z0-9._-]+\.sh)/g)].map((match) => match[1]),
    );
    expect(referenced.size).toBeGreaterThan(0);
    for (const script of referenced) {
      expect(existsSync(join(workflowDir, script)), `missing build-workflow/${script}`).toBe(true);
    }
  });

  it("documents the V2 payload contract and the converted-artifact manifest", () => {
    expect(workflow).toContain(".composition.v2.schemaVersion");
    expect(workflow).toContain("POSTPROCESS_KIND");
    expect(workflow).toContain("qemu-img convert -f raw -O");
    expect(workflow).toContain("COMBINEWRT_MANIFEST=");
    expect(workflow).toContain("COMBINEWRT_FAILED_PACKAGE=");
  });
});

describe.skipIf(!canRunScripts)("variant-config.sh", () => {
  function run(plan: string) {
    const result = spawnSync("bash", [join(workflowDir, "variant-config.sh"), plan], { encoding: "utf8" });
    return result;
  }

  it("matches the site variant mapping for every accepted combination", () => {
    const variants: ImageVariant[] = [];
    for (const boot of ["efi", "legacy"] as const) {
      for (const filesystem of ["ext4", "squashfs"] as const) {
        for (const artifact of ["combined", "rootfs"] as const) {
          variants.push({ boot, filesystem, artifact });
        }
      }
    }
    // Converted artifacts are only offered on the ext4/EFI and squashfs/Legacy
    // combinations the capability registry accepts; both postprocess shapes
    // still go through the same parity check.
    variants.push({ boot: "efi", filesystem: "ext4", artifact: "qcow2", overlaySizeMb: 512 });
    variants.push({ boot: "legacy", filesystem: "squashfs", artifact: "vmdk", overlaySizeMb: 512 });

    for (const variant of variants) {
      const mapping = mapImageVariant({ ...BASE, variant });
      const result = run(planFile(variant));
      expect(result.status, result.stderr).toBe(0);
      const parsed = JSON.parse(result.stdout) as Record<string, unknown>;

      expect(parsed.buildArtifact).toBe(mapping.products[0]);
      expect(parsed.productDir).toBe(mapping.productDir);
      expect(parsed.makeTargets).toEqual(mapping.makeTargets);
      expect(parsed.config).toEqual(mapping.initCommands);
      expect(parsed.command).toBe(imageBuilderCommandForVariant(mapping, BASE.profileId, ["luci"]));
      expect(parsed.postprocess).toEqual(
        mapping.postprocess
          ? {
              kind: mapping.postprocess.kind,
              source: mapping.postprocess.sourcePath,
              raw: mapping.postprocess.rawPath,
              output: mapping.postprocess.outputPath,
              steps: mapping.postprocess.steps.map(shellCommand),
            }
          : null,
      );
    }
  });

  it("rejects a source-engine plan with a readable reason", () => {
    const dir = mkdtempSync(join(tmpdir(), "combinewrt-workflow-"));
    tempDirs.push(dir);
    const file = join(dir, "plan.json");
    const source = readFileSync(planFile({ boot: "efi", filesystem: "ext4", artifact: "combined" }), "utf8");
    const plan = JSON.parse(source) as { composition: { v2: { engine: string } } };
    plan.composition.v2.engine = "source";
    writeFileSync(file, JSON.stringify(plan));
    const result = run(file);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("not built by the ImageBuilder workflow");
  });

  it("keeps the V1 dispatch path validating the same required fields", () => {
    expect(workflow).toContain("client_payload is missing");
    expect(workflow).toContain("jq '.client_payload'");
  });
});

describe.skipIf(!canRunScripts)("fail.sh", () => {
  function runFail(context: string | null): { status: number | null; marker: Record<string, unknown> | null } {
    const script = [
      `source ${JSON.stringify(join(workflowDir, "fail.sh"))}`,
      ...(context ? [`COMBINEWRT_CONTEXT='${context}'`] : []),
      'fail postprocess "" "" "" "qemu-img convert failed"',
    ].join("; ");
    const result = spawnSync("bash", ["-c", script], { encoding: "utf8" });
    const line = result.stdout.split("\n").find((entry) => entry.startsWith("COMBINEWRT_FAILURE="));
    return {
      status: result.status,
      marker: line ? (JSON.parse(line.slice("COMBINEWRT_FAILURE=".length)) as Record<string, unknown>) : null,
    };
  }

  it("emits the structured marker with the V2 context", () => {
    const { status, marker } = runFail(
      '{"target":"x86/64","variant":"efi-ext4-combined","engine":"imagebuilder"}',
    );
    expect(status).toBe(1);
    expect(marker).toEqual({
      step: "postprocess",
      package: null,
      source: null,
      version: null,
      message: "qemu-img convert failed",
      context: { target: "x86/64", variant: "efi-ext4-combined", engine: "imagebuilder" },
    });
  });

  it("keeps the V1 marker shape when no context is set", () => {
    const { status, marker } = runFail(null);
    expect(status).toBe(1);
    expect(marker).toEqual({
      step: "postprocess",
      package: null,
      source: null,
      version: null,
      message: "qemu-img convert failed",
    });
  });
});
