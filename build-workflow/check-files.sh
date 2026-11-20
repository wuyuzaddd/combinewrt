#!/usr/bin/env bash
# Ticket 05: the single rule both build engines apply to `plan.files[]`.
#
# Sourced by `build.yml` ("Write files") and `source-build.yml` ("Write
# generated files overlay"), right after `.github/scripts/fail.sh`. A generated
# file is written into the build tree before `make image`, so a bad entry is
# arbitrary file write as the CI runner. The rule matches
# `src/lib/build/dispatch-files.ts`:
#
# - the path is relative to the build tree and starts with `files/`;
# - the path never traverses with `..`;
# - the mode is one of the two the planner emits: 0644 (420) or 0755 (493).
#
# `src/lib/build/workflow-yaml.test.ts` pins both workflow files to this script,
# keeps the mode list below equal to the TypeScript constant, and runs the
# function against the malicious fixtures.
COMBINEWRT_ALLOWED_FILE_MODES="420 493"

check_generated_file() {
  path=$1
  mode=${2:-420}

  case "$path" in
    files/*) ;;
    *)
      printf '%s\n' "generated file path must start with files/: $path" >&2
      return 1
      ;;
  esac
  case "$path" in
    *..*)
      printf '%s\n' "generated file path must not contain ..: $path" >&2
      return 1
      ;;
  esac
  # The path also may not carry characters the planner never emits (spaces,
  # backslashes, a leading `/`), so the shell copy is not looser than the one in
  # dispatch-files.ts. `files/` is stripped first so only the overlay-relative
  # part is checked.
  rel=${path#files/}
  case "$rel" in
    "" | [!_A-Za-z0-9]* | *[!A-Za-z0-9._/-]*)
      printf '%s\n' "generated file path has unsafe characters: $path" >&2
      return 1
      ;;
  esac
  case " $COMBINEWRT_ALLOWED_FILE_MODES " in
    *" $mode "*)
      ;;
    *)
      printf '%s\n' "generated file mode $mode is not allowed (0644/0755): $path" >&2
      return 1
      ;;
  esac
  return 0
}
