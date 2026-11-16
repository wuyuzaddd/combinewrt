import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

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

describe("workflow signature allow-list", () => {
  // ADR 0007: the default apk path never weakens signature checking. The only
  // `--allow-untrusted` uses are the downloaded-prebuilt verification and the
  // two mkndx calls that index exactly those pinned apks. Pin the exact list so
  // a future edit has to justify itself in this test.
  const ALLOWED: Record<string, number> = {
    "build.yml": 3,
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
    expect(region.split("--allow-untrusted")).toHaveLength(4);
    // The feed preflight resolves real repositories with the project key and
    // must never pass the flag.
    const preflight = source.slice(source.indexOf(`- name: ${FEED_STEP}`), source.indexOf("- name: Build image"));
    expect(preflight).not.toContain("--allow-untrusted");
  });
});
