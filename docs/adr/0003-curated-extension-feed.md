# Curate extension packages through a signed feed

Optional plugins, themes and kernel modules will come from a project-curated registry and a project-signed extension feed. Builds may reference configured signed feeds only; users cannot inject arbitrary feed URLs into a plan.

## Why

One-click proxy plugins and themes are exactly where supply-chain trust and license ambiguity concentrate. Allowing arbitrary feeds would make the public-image license gate meaningless and would let a package URL change after a plan was reviewed. A curated registry keeps the source, license, supported targets and public-distribution eligibility reviewable before a package is offered.

## Consequences

- Every extension package needs an SPDX license, source reference and `publicAllowed` decision.
- GPL-compatible, reviewed packages may be public; proprietary or unknown-license packages are private-only.
- A one-click bundle is a named package set with declared targets, SPDX metadata and at least one dependency/installability test; it is never a script or post-install hook.
- Theme entries are extension packages with preview, LuCI compatibility and default-theme metadata; they enter plans through the same bundle/package path, not through a second installer.
- The extension index shares one distribution site and build farm with the supplement index, but keeps its own pin, review rules and update cadence. Registry refs are watched on a schedule; a failed refresh keeps the last published index.
- Registry changes go through review; the feed is built and signed by the build repository.
- A package that cannot be built reproducibly from its declared source cannot enter the feed.
- Curation covers source, license, ABI, target and `publicAllowed`; it does not require a reviewed translation. When a third-party plugin has no usable i18n, its display text may fall back to upstream strings, auto-extracted strings or machine translation, marked `i18nStatus: auto|unreviewed`. This fallback is metadata only: it never relaxes the admission, license or public-image checks.
