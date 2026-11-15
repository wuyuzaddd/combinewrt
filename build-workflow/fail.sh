#!/usr/bin/env bash
# Emit one machine-readable failure marker and stop the step.
#
# `COMBINEWRT_CONTEXT` (optional compact JSON object set by the plan step for
# schemaVersion 2 payloads) is attached as `context`, so the site can show which
# target/variant/engine failed in addition to the step and package.
fail() {
  if [ -n "${COMBINEWRT_CONTEXT:-}" ]; then
    context_json=$(jq -c 'if type == "object" then . else error("context must be an object") end' <<<"$COMBINEWRT_CONTEXT" 2>/dev/null) || context_json=""
  else
    context_json=""
  fi

  if [ -n "$context_json" ]; then
    jq -cn --arg step "$1" --arg pkg "${2:-}" --arg src "${3:-}" --arg ver "${4:-}" --arg msg "$5" --argjson ctx "$context_json" \
      '{step:$step,package:(if $pkg=="" then null else $pkg end),source:(if $src=="" then null else $src end),version:(if $ver=="" then null else $ver end),message:$msg,context:$ctx}' \
      | sed 's/^/COMBINEWRT_FAILURE=/'
  else
    jq -cn --arg step "$1" --arg pkg "${2:-}" --arg src "${3:-}" --arg ver "${4:-}" --arg msg "$5" \
      '{step:$step,package:(if $pkg=="" then null else $pkg end),source:(if $src=="" then null else $src end),version:(if $ver=="" then null else $ver end),message:$msg}' \
      | sed 's/^/COMBINEWRT_FAILURE=/'
  fi
  exit 1
}
