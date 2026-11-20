#!/usr/bin/env bash
# Redact a build plan on disk before the long build steps run.
#
# Both engines write the generated files overlay into the tree first, because
# `files[].content` carries the root password hash, the PPPoE password and the
# WiFi key. After that one read, nothing needs the bodies again, so this script
# rewrites them to a single at-rest placeholder and chmods the plan to 600:
# a 30-90 minute make must never leave those secrets in a world-readable file
# inside the workspace.
#
# The placeholder is shared with the site's storage redaction
# (`src/lib/builds/redact.ts`): one wording, no byte counts, so a plan cannot
# leak the length of a secret either.
#
# Usage: source .github/scripts/redact-plan.sh; redact_plan [path/to/plan.json]
# The rewrite is temp + mv in the same directory, so the plan is either the
# full one or the redacted one, never truncated.
REDACTED_AT_REST='<redacted at rest>'

redact_plan() {
  local plan="${1:-plan.json}"
  local tmp="${plan}.redacted"
  if [ ! -f "$plan" ]; then
    echo "redact-plan: no plan file at $plan" >&2
    return 1
  fi
  if ! jq -c --arg placeholder "$REDACTED_AT_REST" \
    '.files = ((.files // []) | map(.content = $placeholder))' "$plan" > "$tmp"; then
    rm -f "$tmp"
    echo "redact-plan: failed to rewrite $plan" >&2
    return 1
  fi
  mv "$tmp" "$plan"
  chmod 600 "$plan"
  echo "plan file rewritten with generated file contents redacted: $plan"
}
