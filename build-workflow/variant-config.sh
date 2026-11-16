#!/usr/bin/env bash
# Derive the ImageBuilder command for a schemaVersion 2 plan.
#
# The site sends the accepted variant (`composition.v2.imageVariant`) and the
# product file names it expects (`composition.v2.products`); this script turns
# that into the make variables the upstream x86 ImageBuilder recipe accepts
# (`target/linux/x86/image/Makefile` gates products with Kconfig symbols that
# also work as make variables), the make goals, the product paths and the
# VMDK/qcow2 postprocessing plan.
#
# It is the workflow-side half of `src/lib/image/variants.ts` +
# `src/lib/image/postprocess.ts`; `src/lib/build/workflow.test.ts` runs both
# sides over the eight accepted combinations and fails on drift.
#
# Usage: variant-config.sh plan.json   (writes variant.json-shaped JSON to stdout)
#
# Every rejection prints one line to stderr and exits 1; the calling step turns
# it into a structured COMBINEWRT_FAILURE marker that carries the V2 context.
set -euo pipefail

plan=${1:-plan.json}
die() {
  echo "variant-config: $*" >&2
  exit 1
}

[ -s "$plan" ] || die "plan file $plan is missing or empty"

schema=$(jq -r '.composition.v2.schemaVersion // 1' "$plan")
[ "$schema" = "2" ] || die "plan is not a schemaVersion 2 payload"

engine=$(jq -r '.composition.v2.engine // empty' "$plan")
[ "$engine" = "imagebuilder" ] || die "engine '${engine:-<missing>}' is not built by the ImageBuilder workflow"

boot=$(jq -r '.composition.v2.imageVariant.boot // empty' "$plan")
filesystem=$(jq -r '.composition.v2.imageVariant.filesystem // empty' "$plan")
artifact=$(jq -r '.composition.v2.imageVariant.artifact // empty' "$plan")
overlay=$(jq -r '.composition.v2.imageVariant.overlaySizeMb // empty' "$plan")
target=$(jq -r '.composition.v2.target.id // empty' "$plan")
profile=$(jq -r '.profileId // empty' "$plan")
artifact_name=$(jq -r '.artifactName // empty' "$plan")
packages=$(jq -r '.packages | join(" ")' "$plan")

case "$boot" in
  efi | legacy) ;;
  *) die "unsupported boot mode: '${boot:-<missing>}'" ;;
esac
case "$filesystem" in
  ext4 | squashfs) ;;
  *) die "unsupported filesystem: '${filesystem:-<missing>}'" ;;
esac
# emmc images come from the source engine and are not an x86 ImageBuilder product.
case "$artifact" in
  combined | rootfs | vmdk | qcow2) ;;
  *) die "unsupported artifact kind: '${artifact:-<missing>}'" ;;
esac
[ -n "$profile" ] || die "plan is missing profileId"
[ -n "$artifact_name" ] || die "plan is missing artifactName"
case "$target" in
  "" | *[!a-z0-9_/-]*) die "unsafe or missing target id: '$target'" ;;
  */*/*) die "target id must be <target>/<subtarget>: '$target'" ;;
esac
case "$target" in
  */*) ;;
  *) die "target id must be <target>/<subtarget>: '$target'" ;;
esac

if [ -n "$overlay" ]; then
  case "$overlay" in
    *[!0-9]*) die "overlaySizeMb must be a positive integer: '$overlay'" ;;
  esac
  [ "$overlay" -ge 64 ] && [ "$overlay" -le 262144 ] || die "overlaySizeMb out of range: $overlay"
fi

product_dir="bin/targets/${target}"

# The product name is the site's (ticket 04 naming rules); never re-derive it
# when the payload carries it. The fallback only keeps hand-written fixtures and
# older dispatches working.
product=$(jq -r '.composition.v2.products[0] // empty' "$plan")
if [ -z "$product" ]; then
  case "$artifact" in
    combined | rootfs) product=$artifact_name ;;
    vmdk | qcow2) product="${artifact_name%.*}.img.gz" ;;
  esac
fi
case "$product" in
  "" | *[!A-Za-z0-9._+-]*) die "unsafe or missing product name: '$product'" ;;
esac

config=(
  "CONFIG_TARGET_IMAGES_GZIP=y"
  "CONFIG_GRUB_IMAGES=$([ "$boot" = "legacy" ] && echo y || echo n)"
  "CONFIG_GRUB_EFI_IMAGES=$([ "$boot" = "efi" ] && echo y || echo n)"
  "CONFIG_ISO_IMAGES=n"
  "CONFIG_VDI_IMAGES=n"
  "CONFIG_VHDX_IMAGES=n"
  "CONFIG_VMDK_IMAGES=n"
  "CONFIG_QCOW2_IMAGES=n"
  "CONFIG_TARGET_ROOTFS_EXT4FS=$([ "$filesystem" = "ext4" ] && echo y || echo n)"
  "CONFIG_TARGET_ROOTFS_SQUASHFS=$([ "$filesystem" = "squashfs" ] && echo y || echo n)"
  "CONFIG_TARGET_ROOTFS_TARGZ=$([ "$artifact" = "rootfs" ] && echo y || echo n)"
)
# The squashfs combined image takes its partition layout from the target
# capability, so the requested overlay size is validated but not forwarded.
if [ -n "$overlay" ] && [ "$artifact" != "rootfs" ] && [ "$filesystem" = "ext4" ]; then
  config+=("CONFIG_TARGET_ROOTFS_PARTSIZE=$overlay")
fi

make_targets=("image")
command="make -j\$(nproc) ${make_targets[*]} PROFILE=${profile} PACKAGES=\"${packages}\" FILES=files ${config[*]}"

postprocess=null
case "$artifact" in
  vmdk | qcow2)
    source_path="${product_dir}/${product}"
    raw_path="${source_path%.gz}"
    output_path="${product_dir}/${artifact_name}"
    decompress_command="gzip -dc ${source_path}"
    convert_command="qemu-img convert -f raw -O ${artifact} ${raw_path} ${output_path}"
    postprocess=$(jq -n -c \
      --arg kind "$artifact" \
      --arg source "$source_path" \
      --arg raw "$raw_path" \
      --arg output "$output_path" \
      --argjson steps "$(jq -n -c --arg a "$decompress_command" --arg b "$convert_command" '[$a, $b]')" \
      '{kind:$kind, source:$source, raw:$raw, output:$output, steps:$steps}')
    ;;
esac

jq -n -c \
  --arg buildArtifact "$product" \
  --arg productDir "$product_dir" \
  --argjson config "$(printf '%s\n' "${config[@]}" | jq -R . | jq -s -c .)" \
  --argjson makeTargets "$(printf '%s\n' "${make_targets[@]}" | jq -R . | jq -s -c .)" \
  --arg command "$command" \
  --argjson postprocess "$postprocess" \
  '{buildArtifact:$buildArtifact, productDir:$productDir, makeTargets:$makeTargets, config:$config, command:$command, postprocess:$postprocess}'
