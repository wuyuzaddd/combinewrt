# Use a hybrid build engine

V2 must produce kernel-line variants and image shapes that ImmortalWrt's prebuilt ImageBuilder cannot express, while keeping the common path fast. We will keep ImageBuilder for standard images and add a source-build path for advanced variants, driven by generated configuration rather than a fork of the upstream tree.

## Considered options

- **ImageBuilder only**: simplest and fastest, but locks every build to the release's single kernel and its shipped profiles/artifact formats.
- **Source build for everything**: maximum control, but turns a 10–20 minute build into a 30–90 minute build and makes caching, runner time and failure diagnosis much harder.
- **Hybrid (chosen)**: standard builds stay on ImageBuilder; only kernel variants, special artifacts and combinations that require it use the source-build workflow.

## Consequences

- Two pipelines must share the same plan, package-provenance and failure-marker contracts.
- The source-build workflow consumes upstream ImmortalWrt source with a generated config fragment; there is no maintained fork.
- Toolchain/SDK caches become part of the build contract.
- Source builds run on GitHub-hosted runners in V2.0 and must fit the six-hour job limit. Docker and kernel-line variants are the first source-build acceptance cases.
- The capability registry decides which pipeline a requested variant needs, so the UI never offers an impossible combination.
