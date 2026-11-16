import type { BuildPlan } from "../build/types";

/**
 * Redaction at rest for build plans (V2 review, P1 secrets).
 *
 * A plan carries three kinds of secret that the build workflow needs exactly
 * once, at dispatch time:
 *
 * - `files[].content`: the root password hash, the PPPoE password and the WiFi
 *   key are rendered into uci-defaults/samba/dockerd files;
 * - `modes.network.wan.password` and `modes.network.wifi.key`: the typed
 *   network secrets themselves.
 *
 * `builds.plan_json` is a long-lived row that is copied into every database
 * dump, so the store writes a redacted copy. The queue keeps the full plan in
 * memory for the dispatch that follows immediately after `submit()`; a plan
 * restored from the database cannot be rebuilt and is failed explicitly rather
 * than silently dispatched without its files overlay.
 */
export const REDACTED_VALUE = "<redacted at rest>";
export const REDACTED_MARKER = "__redacted";

interface LoosePlan {
  files?: Array<{ path: string; content: string; mode: number }>;
  modes?: {
    network?: {
      wan?: { password?: string };
      wifi?: { key?: string } | null;
    };
  };
  [key: string]: unknown;
}

export function redactPlanForStorage(plan: BuildPlan): BuildPlan {
  const copy = JSON.parse(JSON.stringify(plan)) as LoosePlan;
  const redacted: string[] = [];

  if (Array.isArray(copy.files) && copy.files.length > 0) {
    copy.files = copy.files.map((file) => ({
      path: file.path,
      mode: file.mode,
      content: REDACTED_VALUE,
    }));
    redacted.push("files.content");
  }

  const wan = copy.modes?.network?.wan;
  if (typeof wan?.password === "string" && wan.password.length > 0) {
    wan.password = REDACTED_VALUE;
    redacted.push("modes.network.wan.password");
  }
  const wifi = copy.modes?.network?.wifi;
  if (wifi && typeof wifi.key === "string" && wifi.key.length > 0) {
    wifi.key = REDACTED_VALUE;
    redacted.push("modes.network.wifi.key");
  }

  if (redacted.length > 0) {
    copy[REDACTED_MARKER] = redacted;
  } else {
    delete copy[REDACTED_MARKER];
  }
  return copy as unknown as BuildPlan;
}

/**
 * True when this plan came back from storage without its secrets. The queue
 * must not dispatch it: the image would silently lose its generated files.
 */
export function isRedactedPlan(plan: BuildPlan): boolean {
  const marker = (plan as unknown as LoosePlan)[REDACTED_MARKER];
  return Array.isArray(marker) && marker.length > 0;
}
