#!/usr/bin/env bash
# Emit one machine-readable failure marker and stop the step.
fail() {
  jq -cn --arg step "$1" --arg pkg "${2:-}" --arg src "${3:-}" --arg ver "${4:-}" --arg msg "$5" \
    '{step:$step,package:(if $pkg=="" then null else $pkg end),source:(if $src=="" then null else $src end),version:(if $ver=="" then null else $ver end),message:$msg}' \
    | sed 's/^/COMBINEWRT_FAILURE=/'
  exit 1
}
