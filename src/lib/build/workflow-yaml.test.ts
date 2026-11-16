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

function readWorkflow(): Workflow {
  const source = readFileSync(new URL("../../../build-workflow/build.yml", import.meta.url), "utf8");
  return yaml.load(source) as Workflow;
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
  const source = readFileSync(new URL("../../../build-workflow/source-build.yml", import.meta.url), "utf8");
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
