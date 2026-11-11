import type { ArtifactDownload, BuildAdapter, RunUpdate } from "./types";

export function createFakeAdapter(): BuildAdapter {
  let sequence = 0;
  const polls = new Map<string, number>();

  return {
    name: "fake",
    async dispatch() {
      const runId = `fake-run-${++sequence}`;
      polls.set(runId, 0);
      return { runId };
    },
    async getRun(runId: string): Promise<RunUpdate> {
      const count = (polls.get(runId) ?? 0) + 1;
      polls.set(runId, count);
      if (count === 1) {
        return { status: "queued", logTail: "[stub] queued\n" };
      }
      if (count === 2) {
        return { status: "running", logTail: "[stub] preparing image builder\n" };
      }
      return {
        status: "succeeded",
        logTail: "[stub] image built\n[stub] artifact uploaded\n",
        artifactName: `build-${runId}.zip`,
      };
    },
    async downloadArtifact(_runId: string, artifactName: string): Promise<ArtifactDownload> {
      void _runId;
      return {
        name: artifactName.endsWith(".zip") ? artifactName : `${artifactName}.zip`,
        contentType: "application/zip",
        body: new Uint8Array(Buffer.from("PK\u0005\u0006\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000", "binary")),
      };
    },
  };
}
