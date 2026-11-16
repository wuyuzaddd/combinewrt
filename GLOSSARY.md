# CombineWRT

CombineWRT builds ImmortalWrt firmware images from a curated catalog, with explicit package provenance and reproducible build records.

## Build inputs

**Base version**:
An ImmortalWrt release or snapshot version that identifies the upstream source basis for a catalog snapshot and a build.
_Avoid_: baseline, firmware version

**Release**:
A versioned ImmortalWrt release with a fixed release date and ImageBuilder checksum.
_Avoid_: stable build

**Snapshot channel**:
The rolling ImmortalWrt build channel whose contents change without a stable version identity.
_Avoid_: nightly, latest

**Kernel line**:
A major/minor Linux kernel family that a build targets: 6.6, 6.12 or 6.18. 6.12 is the V2.0 default and release gate; 6.6 and 6.18 are experimental until they pass the acceptance matrix.
_Avoid_: kernel version, kernel baseline

**Target**:
An OpenWrt target/subtarget pair, such as `x86/64`, that determines CPU support and available image artifacts.
_Avoid_: platform, architecture

**Device profile**:
An ImageBuilder profile inside a target that identifies a board or a generic device image.
_Avoid_: model, device

**Capability registry**:
The checked-in declaration of which image variants, boot modes, filesystems and overlays each target and device profile supports.
_Avoid_: device database, profile list

## Configuration

**Configuration preset (Mode)**:
A named, declarative build input that sets configuration values, adds a package set, and may generate controlled files. It declares requires/conflicts and never contains scripts, hooks or arbitrary shell.
_Avoid_: profile, template, one-click bundle

**Mode layer**:
The layer a preset changes: file/board defaults, package/kernel modules, or kernel configuration. A preset that changes kernel configuration requires a source build.
_Avoid_: switch type

**Base preset**:
The single preset that starts a build plan.

**Mode overlay**:
An optional preset stacked on a base preset. Its requires/conflicts are checked while planning; an unresolved conflict rejects the plan.

**Experimental mode**:
A preset offered only on capable targets but outside the V2.0 acceptance matrix; the UI must say so and must not present it as supported.

## Image shape

**Image variant**:
A buildable combination of boot mode, filesystem, artifact kind and overlay settings.
_Avoid_: image type, output format

**Boot mode**:
The firmware boot path: EFI or Legacy BIOS.
_Avoid_: firmware mode

**Filesystem**:
The root filesystem layout: ext4 or squashfs.
_Avoid_: rootfs type

**Artifact kind**:
The delivered image form: combined disk image, rootfs archive, VMDK, qcow2, or eMMC image.
_Avoid_: image format, output

**Overlay**:
The writable partition or filesystem that stores changes after the firmware image is written.
_Avoid_: data partition

## Packages and provenance

**Package source**:
The origin of a package: official ImmortalWrt feed, dllkids feed, supplement feed, or extension feed.
_Avoid_: repository, repo

**External package source**:
A third-party repository, feed or release page registered as a controlled input. Its packages are never fetched from an arbitrary URL at build time.
_Avoid_: upstream repo, third-party feed

**Supplement feed**:
A project-signed feed of packages that fill gaps in the official and dllkids feeds for a base version. It is separate from the extension feed and follows the base-version upgrade path.
_Avoid_: extra feed, gap feed

**Package variant**:
One package built for a specific target, kernel line and ABI. Buildability and acquisition are decided per variant, not per package name.
_Avoid_: package build, arch variant

**Acquisition strategy**:
How a package variant enters a build: `prebuilt` (verified upstream binary), `rebuild` (built by the project farm from declared source), or `blocked` (not installable under policy). A prebuilt variant may fall back to rebuild.
_Avoid_: source mode, package policy

**Signed distribution index**:
A signed `packages.adb` served from the distribution site. The supplement and extension feeds each have their own index and source pin.
_Avoid_: package list, feed file

**Image feed set**:
The apk repositories and public keys written into an image so the running system can install packages. It is separate from the build-time package resolution and can be pinned to the base version.
_Avoid_: feeds, opkg feeds

**Source pin**:
The immutable upstream identity of a package source, such as a feed commit, a signed index checksum, or a signing-key fingerprint.
_Avoid_: version, hash

**Source watch**:
The scheduled observation of external package sources for a changed commit or index checksum. It records candidates; adoption is a separate decision.
_Avoid_: sync job, mirror

**Source candidate**:
An observed upstream identity that differs from the active pin but has not been adopted. A candidate may be automatic or may require review.
_Avoid_: new pin, update

**Pin adoption**:
The act of making a source candidate the active pin for future catalog snapshots and builds. Adoption is transactional and recorded in pin history.
_Avoid_: bump, switch

**Pin history**:
The append-only record of active pins, candidates, adoptions and rollbacks, with timestamps and the catalog snapshot each adoption produced.
_Avoid_: changelog, audit log

**Staging feed**:
A signed feed built from a new source commit that has not replaced the live feed. It is used when metadata changed or verification failed.
_Avoid_: test feed, draft feed

**Extension feed**:
A project-curated, signed package feed for optional plugins, themes and kernel modules.
_Avoid_: third-party feed, plugin repository

**Package display i18n**:
The translated name/description/help text shown for a package in the catalog and plan UI. Curated text is reviewed; third-party plugins may fall back to upstream or automatic text.

**Unreviewed i18n**:
Display text taken from upstream, auto-extraction or machine translation when a third-party plugin has no usable reviewed translation. It is labelled in the UI and is metadata only; it never counts as source, license, ABI or `publicAllowed` evidence.
_Avoid_: machine translation, auto description (when the distinction matters)

**One-click bundle**:
A named, curated set of packages from the extension feed; it never contains scripts or arbitrary install commands.
_Avoid_: plugin pack, preset

**Build plan**:
An immutable, validated description of a build: base version, target, profile, image variant, configuration, packages and source pins.
_Avoid_: build config, job

**Build**:
One execution of a build plan, including its status, failure diagnosis, timeline and artifacts.
_Avoid_: job, run

**Source offer**:
The machine-readable provenance document for a build, including upstream commits, package sources, patches and distribution eligibility.
_Avoid_: license page, attribution

## Distribution

**Public image**:
A firmware image intended for distribution outside the operator's own use; it must pass the package license gate.
_Avoid_: published image, release image

**Private image**:
A firmware image built for the operator's own use and not distributed.
_Avoid_: personal image

**Simple mode**:
The default build experience: device, base version, image variant, basic configuration and curated packages.
_Avoid_: basic mode, wizard

**Advanced mode**:
The build experience that exposes targets, kernel lines, source pins, build plans, source offers, base-version management and workflow runs.
_Avoid_: expert mode, admin mode
