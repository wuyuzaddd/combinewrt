import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { REDACTED_VALUE } from "../builds/redact";
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
    // The placeholder and temp+mv rewrite live in the shared script now.
    expect(readFileSync(join(workflowDir, "redact-plan.sh"), "utf8")).toContain("<redacted at rest>");
    expect(workflow).toContain("redact_plan plan.json");
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

describe.skipIf(!canRunScripts)("redact-plan.sh", () => {
  const scriptPath = join(workflowDir, "redact-plan.sh");

  function redact(plan: string) {
    const dir = mkdtempSync(join(tmpdir(), "combinewrt-redact-"));
    tempDirs.push(dir);
    const file = join(dir, "plan.json");
    writeFileSync(file, plan);
    const result = spawnSync("bash", ["-c", `source ${JSON.stringify(scriptPath)}; redact_plan ${JSON.stringify(file)}`], {
      encoding: "utf8",
    });
    return { dir, file, result };
  }

  it("uses the same placeholder constant as the site's storage redaction", () => {
    // One wording for the plan at rest: the workflow shell and redact.ts must
    // not drift into "<redacted; N bytes>" again.
    expect(readFileSync(scriptPath, "utf8")).toContain(`REDACTED_AT_REST='${REDACTED_VALUE}'`);
  });

  it("replaces every generated file body with the at-rest placeholder by temp+mv", () => {
    const plan = {
      schemaVersion: 2,
      artifactName: "immortalwrt-x86-64-generic-squashfs-combined.img.gz",
      config: "CONFIG_TARGET_x86=y\n",
      files: [
        { path: "files/etc/shadow", mode: 384, content: "root:$1$salt$hash:0:0:99999:7:::" },
        { path: "files/etc/config/network", mode: 384, content: "config interface 'wan'\n\toption password 'pppoe-secret'\n" },
      ],
    };
    const { dir, file, result } = redact(JSON.stringify(plan));
    expect(result.status, result.stderr).toBe(0);
    const rewritten = JSON.parse(readFileSync(file, "utf8")) as {
      files: Array<{ path: string; mode: number; content: string }>;
      config: string;
    };
    expect(rewritten.files.map((entry) => entry.content)).toEqual(["<redacted at rest>", "<redacted at rest>"]);
    // Everything the build still needs survives the rewrite.
    expect(rewritten.files.map((entry) => entry.path)).toEqual(plan.files.map((entry) => entry.path));
    expect(rewritten.files.map((entry) => entry.mode)).toEqual([384, 384]);
    expect(rewritten.config).toBe(plan.config);
    // No temporary file is left behind and no secret byte remains.
    expect(readFileSync(file, "utf8")).not.toContain("pppoe-secret");
    expect(readFileSync(file, "utf8")).not.toContain("root:$1$salt$hash");
    expect(existsSync(join(dir, "plan.json.redacted"))).toBe(false);
  });

  it("chmods the plan to 600 and keeps the placeholder free of byte counts", () => {
    const { file, result } = redact(
      JSON.stringify({ files: [{ path: "files/etc/uci-defaults/99-combinewrt", mode: 493, content: "secret\n" }] }),
    );
    expect(result.status, result.stderr).toBe(0);
    const mode = (statSync(file).mode & 0o777).toString(8);
    expect(mode).toBe("600");
    expect(readFileSync(file, "utf8")).not.toMatch(/redacted[^"]*\d+ bytes/);
    expect(readFileSync(file, "utf8")).toContain('"<redacted at rest>"');
  });

  it("fails without clobbering the plan when the JSON cannot be parsed", () => {
    const { dir, file, result } = redact("{not json");
    expect(result.status).not.toBe(0);
    expect(readFileSync(file, "utf8")).toBe("{not json");
    expect(existsSync(join(dir, "plan.json.redacted"))).toBe(false);
  });
});

describe("workflow scripts", () => {
  it("references only scripts that exist in build-workflow/ for both engines", () => {
    for (const name of ["build.yml", "source-build.yml"]) {
      const text = readFileSync(join(workflowDir, name), "utf8");
      const referenced = new Set(
        [...text.matchAll(/\.github\/scripts\/([A-Za-z0-9._-]+\.sh)/g)].map((match) => match[1]),
      );
      expect(referenced.size, name).toBeGreaterThan(0);
      for (const script of referenced) {
        expect(existsSync(join(workflowDir, script)), `missing build-workflow/${script} called by ${name}`).toBe(
          true,
        );
      }
    }
  });
});
