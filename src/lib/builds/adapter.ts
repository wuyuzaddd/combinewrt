import type { AppConfig } from "../config";
import { createFakeAdapter } from "./fake";
import { createGitHubAdapter } from "./github";
import type { BuildAdapter } from "./types";

export function createAdapter(config: AppConfig): BuildAdapter {
  if (config.buildAdapter === "github") {
    return createGitHubAdapter({
      repo: config.buildRepo,
      token: config.buildRepoToken,
      workflow: config.buildWorkflow,
    });
  }
  if (config.buildAdapter === "fake") return createFakeAdapter();
  throw new Error(`unsupported build adapter: ${String(config.buildAdapter)}`);
}
