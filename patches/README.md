# Patches

This directory holds patches applied on top of the pinned upstream sources.
There are currently no patches.

Rules for any patch added here:

1. Prefix the file with an SPDX header:
   `SPDX-License-Identifier: GPL-2.0-only`.
2. Keep OpenWrt/ImmortalWrt-derived changes in this directory, separate from the
   MIT-licensed site code.
3. Register the patch in `src/lib/build/patches.ts` so every source-offer
   manifest lists it with its license and upstream source.
4. Never add third-party source trees or proprietary binaries to this
   repository. Reference feeds by URL and checksum instead.

See `NOTICE` and `LICENSES/GPL-2.0-only.txt`.
