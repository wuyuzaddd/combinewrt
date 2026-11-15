import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

const nodeRequire = createRequire(import.meta.url);
const yaml = nodeRequire("js-yaml") as { load(input: string): unknown };

type WorkflowStep = { name?: string; run?: string; uses?: string };
type Workflow = { jobs: Record<string, { steps: WorkflowStep[] }> };

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
