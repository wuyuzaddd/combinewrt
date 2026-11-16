# Compose sources through a rebuild farm

V2 will combine the official and dllkids feeds, a project supplement index, and a curated extension index. External package sources enter through a reviewed registry; each package variant is either installed from a verified upstream binary or rebuilt by the project farm. No build may inject an arbitrary feed URL.

## Why

A signed feed answers "how do we carry packages", not "where does the content come from, how fresh is it, and will the combination install". Source policy has to be explicit per variant because the same plugin may be safe and ABI-compatible on one target/kernel line and impossible on another. Mirroring every upstream binary would also take on redistribution obligations the project cannot audit.

## Decision

- One distribution site hosts two signed indexes: `supplement` for gap-fill packages tied to a base version, and `extension` for curated optional packages. They share one build farm and signing pipeline, but have separate pins, update cadence and review rules.
- Every external package source is registered with its upstream URL, source reference, SPDX license, signature or pinned checksum, supported targets and kernel lines, and a `publicAllowed` decision. Only registered sources may be used by a plan.
- Acquisition is decided per package variant (`target × kernel line × ABI`) as `prebuilt`, `rebuild`, or `blocked`, with prebuilt-to-rebuild fallback when a binary is unavailable or incompatible.
- dllkids is a prebuilt binary feed, not a source feed. It is consumed as `prebuilt`; rebuilding one of its packages requires a separate registered source recipe and produces a different, project-signed package. `kenzok8/small-package` or similar feeds are never appended wholesale at build time; only the specific recipe for a requested package is pinned and installed.
- A public image may use a prebuilt binary only when its license permits redistribution, its ABI/vermagic matches, and it has a verified signature or pinned sha256 plus a source offer. A private image may relax the signature requirement to a pinned sha256. Proprietary or unknown-license packages never enter a public image.
- Prebuilt sources are not mirrored in V2.0; the registry stores URL plus pin. Rebuilt packages are cached content-addressed by source commit, recipe hash, target, kernel line and apk-tools version, keeping the last three versions or 180 days.
- Prebuilt indexes are polled every six hours. Rebuild sources use a webhook plus a daily fallback. A change must be detected within 24 hours and an affected variant rebuilt or republished within 48 hours. A failed update keeps the last good package and does not block unrelated packages.
- The distribution site has a 1 GB published-site budget on GitHub Pages. At 700 MB the project moves large packages to GitHub Releases or object storage and keeps the signed indexes on Pages.

## Consequences

- The registry, not the build workflow, is the authority for source and license decisions.
- A package whose source or license cannot be reviewed cannot be offered, even privately.
- Index pins change when either feed changes; a snapshot records both pins.
- `kernel.bin` is not produced in V2.0 because it is a byte copy of `bzImage` with no independent rootfs and no PXE/netboot requirement.
