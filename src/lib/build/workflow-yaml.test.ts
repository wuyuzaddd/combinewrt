import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";
import { ALLOWED_GENERATED_FILE_MODES } from "./dispatch-files";

const nodeRequire = createRequire(import.meta.url);
const yaml = nodeRequire("js-yaml") as { load(input: string): unknown };

type WorkflowStep = { name?: string; run?: string; uses?: string };
type Workflow = {
  jobs: Record<string, { steps: WorkflowStep[] }>;
  concurrency?: { group?: string; "cancel-in-progress"?: boolean };
  "run-name"?: string;
};

const FEED_STEP = "Install feed key and preflight packages";

function readFile(name: string): string {
  return readFileSync(new URL(`../../../build-workflow/${name}`, import.meta.url), "utf8");
}

function readWorkflow(): Workflow {
  return yaml.load(readFile("build.yml")) as Workflow;
}

describe("build workflow", () => {
  it("parses as YAML and keeps the feed/preflight step before the image build", () => {
    const steps = readWorkflow().jobs.build.steps;
    const names = steps.map((step) => step.name ?? step.uses ?? "");
    const write = names.indexOf("Write files");
    const feed = names.indexOf(FEED_STEP);
    const build = names.indexOf("Build image");
    expect(write).toBeGreaterThanOrEqual(0);
    expect(feed).toBeGreaterThan(write);
    expect(build).toBeGreaterThan(feed);
  });

  it("keys the concurrency group on the build id so one build cannot double-run", () => {
    const workflow = readWorkflow();
    expect(workflow["run-name"]).toContain("client_payload.buildId");
    expect(workflow.concurrency?.["cancel-in-progress"]).toBe(false);
    expect(workflow.concurrency?.group).toContain("client_payload.buildId");
    expect(workflow.concurrency?.group).toContain("inputs.build_id");
  });

  it("installs the pinned feed key and simulates the exact package list", () => {
    const steps = readWorkflow().jobs.build.steps;
    const run = steps.find((step) => step.name === FEED_STEP)?.run ?? "";
    expect(run).toContain("composition.feedSet.key.fingerprint");
    expect(run).toContain("files/etc/apk/keys/combinewrt-feed.pub.pem");
    expect(run).toContain("add --simulate");
    expect(run).not.toContain("--allow-untrusted");
    expect(run).toContain("fail preflight");
  });
});

describe("extension workflow", () => {
  const source = readFileSync(
    new URL("../../../build-workflow/extension.yml", import.meta.url),
    "utf8",
  );

  it("parses as YAML and keeps the build signing key out of the published artifact", () => {
    const workflow = yaml.load(source) as Workflow;
    expect(Object.keys(workflow.jobs)).toEqual(expect.arrayContaining(["prepare", "build", "manifest"]));
    expect(source).toContain("name: build-signing-key");
    // The per-build key only exists so each leg can check its own output; it is
    // never published, because the feed is signed by the stable project key.
    expect(source).not.toContain("apk-signing-key");
  });

  it("verifies the built apk with the build key and no --allow-untrusted", () => {
    const steps = (yaml.load(source) as Workflow).jobs.build.steps;
    const run = steps.find((step) => step.name === "Verify built apk signature")?.run ?? "";
    expect(run).toContain('verify --keys-dir "$key_dir" "$apk_file"');
    expect(run).not.toContain("--allow-untrusted");
  });
});

describe("source-build workflow", () => {
  const source = readFile("source-build.yml");
  const workflow = yaml.load(source) as Workflow;

  it("keeps the repository_dispatch event type the site sends", () => {
    expect(source).toContain("types: [combinewrt-source-build]");
    expect(source).toContain("workflow_dispatch:");
  });

  it("keys its concurrency group on the build id so the same build cannot double-run", () => {
    expect(workflow["run-name"]).toContain("client_payload.buildId");
    expect(workflow.concurrency?.["cancel-in-progress"]).toBe(false);
    expect(workflow.concurrency?.group).toContain("client_payload.buildId");
    expect(workflow.concurrency?.group).toContain("inputs.build_id");
  });
});


describe("source-build recipe payload", () => {
  const source = readFile("source-build.yml");

  it("writes the plan's files overlay into the source tree before make", () => {
    // spec:106: the source engine used to drop plan.files, so docker/NAS/network
    // modes were inert on 6.6/6.18. The workflow must write them into
    // <source>/files, which OpenWrt applies from $(TOPDIR)/files.
    expect(source).toContain("- name: Write generated files overlay");
    expect(source).toContain("jq -c '.files[]'");
    expect(source).toContain('mkdir -p "$(dirname "$path")"');
    expect(source).toContain("files/etc/apk/keys/combinewrt-feed.pub.pem");
    expect(source).toContain("- name: Verify generated files overlay in the image");
    const write = source.indexOf("- name: Write generated files overlay");
    const build = source.indexOf("- name: Build image");
    expect(write).toBeGreaterThanOrEqual(0);
    expect(build).toBeGreaterThan(write);
  });

  it("reads the nested repository_dispatch payload shape", () => {
    // The dispatch nests the recipe under composition to stay inside the ten
    // top-level property rule; the workflow normalises it back to a flat recipe.
    expect(source).toContain(".composition | type == \"object\"");
    expect(source).toContain(".composition + {buildId");
  });

  it("does not keep the dead ticket-branch push trigger", () => {
    expect((yaml.load(source) as { on: Record<string, unknown> }).on).not.toHaveProperty("push");
    expect(source).not.toContain("v2/ticket-06");
  });
});

describe("source-build overlay verification (docker data root)", () => {
  const workflow = yaml.load(readFile("source-build.yml")) as Workflow;
  const verify =
    workflow.jobs.build.steps.find(
      (step) => step.name === "Verify generated files overlay in the image",
    )?.run ?? "";

  it("tolerates gzip's padding warning instead of dying before any check", () => {
    // Run 43891611647 aborted inside `gzip -dc`: the image carries padding after
    // the gzip member, gzip verifies the stream and exits 2 with only
    // "trailing garbage ignored", and `set -e` killed the step before it mounted
    // anything. The fix has to keep accepting exactly that case.
    expect(verify).toContain("trailing garbage ignored");
    expect(verify).toContain("gzip_status=$?");
    expect(verify).toContain('[ "$gzip_status" -ne 0 ]');
    expect(verify).toContain("gzip could not decompress");
    // The tolerance branch runs before the image is loop-mounted and checked.
    const gzipStatus = verify.indexOf("gzip_status=$?");
    const mountLoop = verify.indexOf("LOOP=$(sudo losetup");
    expect(gzipStatus).toBeGreaterThan(0);
    expect(mountLoop).toBeGreaterThan(gzipStatus);
  });

  it("asserts every planned file exists with the mode the plan recorded", () => {
    expect(verify).toContain("stat -c '%a'");
    expect(verify).toContain("MODE MISMATCH");
    expect(verify).toContain(".files[$i].mode // 420");
    expect(verify).toContain("planned generated file(s) are missing from the image");
  });

  it("proves the docker uci-defaults on a writable /var instead of the mounted root", () => {
    expect(verify).toContain('.modes | index("docker")');
    expect(verify).toContain("mkdir -p /var/lib/docker");
    expect(verify).toContain("chmod 0711 /var/lib/docker");
    expect(verify).toContain('readlink "$var_host"');
    expect(verify).toContain("sudo mount -t tmpfs");
    expect(verify).toContain('sudo chroot "$ROOT" /bin/sh /etc/uci-defaults/91-combinewrt-docker');
    expect(verify).toContain(".combinewrt-write-test");
    expect(verify).toContain("option data_root '/var/lib/docker'");
    // /etc/config/dockerd is a 0600 root:root conffile; reading it without sudo
    // is what failed run 44294935617 after every other check had passed.
    expect(verify).toContain('sudo grep -qF "option data_root \'/var/lib/docker\'"');
    expect(verify).toContain("sudo sed -n");
    expect(verify).toContain("docker data root verified at first boot");
    // The tmpfs has to be mounted before the uci-defaults runs, otherwise the
    // check would model the read-only mounted image again.
    expect(verify.indexOf("mount -t tmpfs")).toBeLessThan(
      verify.indexOf('sudo chroot "$ROOT" /bin/sh /etc/uci-defaults/91-combinewrt-docker'),
    );
    // root can always write, so `test -w` must never be the assertion.
    expect(verify).not.toContain('[ ! -w "$ROOT/var/lib/docker" ]');
  });

  it("stays skippable when the plan carries no generated files", () => {
    expect(verify).toContain("plan carries no generated files; nothing to verify");
    expect(verify).toContain("fail verify-files");
  });
});

describe("workflow signature allow-list", () => {
  // ADR 0007: the default apk path never weakens signature checking. The only
  // `--allow-untrusted` uses are the downloaded-prebuilt verification and the
  // mkndx calls that index exactly those pinned apks (root index plus the
  // arch-scoped copy apk resolves). Pin the exact list so a future edit has to
  // justify itself in this test.
  const ALLOWED: Record<string, number> = {
    "build.yml": 4,
    "extension.yml": 0,
    "source-build.yml": 0,
  };

  for (const [name, allowed] of Object.entries(ALLOWED)) {
    it(`keeps ${name} at ${allowed} executable --allow-untrusted use(s)`, () => {
      const lines = readFile(name)
        .split("\n")
        .filter((line) => line.includes("--allow-untrusted") && !line.trimStart().startsWith("#"));
      expect(lines).toHaveLength(allowed);
    });
  }

  it("uses --allow-untrusted only for the pinned third-party package steps", () => {
    const source = readFile("build.yml");
    const start = source.indexOf("- name: Download pinned third-party packages");
    const end = source.indexOf("- name: Write files");
    const region = source.slice(start, end);
    expect(region.split("--allow-untrusted")).toHaveLength(5);
    // The feed preflight resolves real repositories with the project key and
    // must never pass the flag.
    const preflight = source.slice(source.indexOf(`- name: ${FEED_STEP}`), source.indexOf("- name: Build image"));
    expect(preflight).not.toContain("--allow-untrusted");
  });
});

describe("shared generated-file rule (ticket 05)", () => {
  // Ticket 05: BOTH build engines must apply the same `plan.files[]` rule. This
  // allow-list is the point of the test: a new engine cannot be added without
  // either appearing here or failing the "every workflow references the rule"
  // expectation below.
  const ENGINES = ["build.yml", "source-build.yml"] as const;
  const scriptPath = new URL("../../../build-workflow/check-files.sh", import.meta.url).pathname;

  for (const name of ENGINES) {
    it(`${name} sources the shared check and fails write-files on a bad entry`, () => {
      const source = readFile(name);
      expect(source).toContain("source .github/scripts/check-files.sh");
      expect(source).toContain('check_generated_file "$path" "$mode"');
      expect(source).toContain("fail write-files");
    });
  }

  it("keeps the workflow engine allow-list to the two real engines", () => {
    expect([...ENGINES].sort()).toEqual(["build.yml", "source-build.yml"]);
  });

  it("keeps the shell mode allow-list equal to the TypeScript predicate", () => {
    const match = /COMBINEWRT_ALLOWED_FILE_MODES="([^"]*)"/.exec(readFile("check-files.sh"));
    expect(match).not.toBeNull();
    const shellModes = match![1]!.split(/\s+/).filter(Boolean).sort();
    const tsModes = [...ALLOWED_GENERATED_FILE_MODES].map(String).sort();
    expect(shellModes).toEqual(tsModes);
  });

  const canRunBash = spawnSync("bash", ["--version"], { stdio: "ignore" }).status === 0;

  function shellCheck(path: string, mode: string): number | null {
    const result = spawnSync(
      "bash",
      ["-c", '. "$1"; check_generated_file "$2" "$3"', "check", scriptPath, path, mode],
      { encoding: "utf8" },
    );
    return result.status;
  }

  it.skipIf(!canRunBash)("rejects the malicious fixtures in the rule both workflows run", () => {
    const malicious: Array<[string, string]> = [
      ["../../etc/passwd", "420"],
      ["/etc/shadow", "420"],
      ["files/../x", "420"],
      ["files/etc/../../x", "420"],
      ["files//etc/passwd", "420"],
      ["files/etc/config/x", "2047"],
      ["files/etc/config/x", "384"],
    ];
    for (const [path, mode] of malicious) {
      expect(shellCheck(path, mode), `${path} mode ${mode}`).not.toBe(0);
    }
  });

  it.skipIf(!canRunBash)("accepts the legitimate files/ entries the planner emits", () => {
    expect(shellCheck("files/etc/uci-defaults/99-combinewrt", "493")).toBe(0);
    expect(shellCheck("files/etc/config/samba4", "420")).toBe(0);
  });
});

describe("shared plan-file redaction", () => {
  const build = readFile("build.yml");
  const source = readFile("source-build.yml");

  it("sources the shared redact-plan.sh from both engines", () => {
    // Ticket 06: both engines must run the same shell, so the redaction cannot
    // drift again the way it did when only build.yml had it.
    for (const [name, text] of [["build.yml", build], ["source-build.yml", source]] as const) {
      expect(text, name).toContain("source .github/scripts/redact-plan.sh");
      expect(text, name).toMatch(/redact_plan\b/);
    }
  });

  it("redacts the source-build plan after the files overlay and before make", () => {
    const steps = (yaml.load(source) as Workflow).jobs.build.steps;
    const names = steps.map((step) => step.name ?? "");
    const write = names.indexOf("Write generated files overlay");
    const redact = names.indexOf("Redact plan file");
    const buildStep = names.indexOf("Build image");
    expect(write).toBeGreaterThanOrEqual(0);
    expect(redact).toBeGreaterThan(write);
    expect(buildStep).toBeGreaterThan(redact);
    expect(steps[redact].run).toContain('redact_plan "$GITHUB_WORKSPACE/plan.json"');
  });

  it("keeps the temp+mv rewrite and chmod 600 in the shared script, not the YAML", () => {
    // The YAML only calls the script; the at-rest mechanics exist once.
    for (const text of [build, source]) {
      expect(text).not.toContain("plan.json.redacted");
      expect(text).not.toContain("<redacted");
      expect(text).not.toContain("chmod 600 plan.json");
    }
  });
});
