# Model configuration modes as presets

V2 will expose "modes" as declarative configuration presets, not as shell snippets or a second form layer. A preset can set configuration values, add a package set, and generate controlled files, but it cannot run arbitrary scripts or post-install hooks.

## Why

The requested switches differ in where they act. Branding and default network ports are file/board changes; USB and WWAN support are package and kernel-module changes; Docker needs kernel configuration and therefore a source build. Treating all of them as one kind of toggle would either promise changes ImageBuilder cannot make or turn the build into an unauditable script runner.

## Decision

- A **Configuration preset (Mode)** is a named, declarative input with a mode layer, configuration values, a package set, optional controlled generated files, and requires/conflicts.
- A plan has one base preset and zero or more overlays. Overlays stack only when requires/conflicts resolve; an unresolved conflict rejects the plan with a readable reason. There are no implicit combinations.
- Installability has two checks: a catalog-level dependency closure for the plan preview, and an `apk add --simulate` preflight in the workflow after the exact packages are downloaded and before `make image`. The preflight is authoritative and must name the package, source and missing dependency.
- V2.0 includes file/board presets: fake iStoreOS branding, NAS package set/theme, switch default port, default eth0 WAN, web server choice (uhttpd/nginx; lighttpd experimental), and HTTPS.
- Docker is a package/kernel-config preset and requires the source-build path. Its V2.0 acceptance shape is ext4 combined plus overlay with `/var/lib/docker` on writable storage; squashfs is not a Docker acceptance shape.
- NAS mode configures Samba and disk tools but never partitions, formats or mounts a disk automatically. Destructive disk operations remain an explicit user action.
- The initial mode matrix is:
  - `istoreos-brand`: file/board; changes `DISTRIB_ID`/description and theme only, no iStore proprietary packages; may stack with NAS.
  - `nas`: package/file; Samba, LuCI, disk tools, rsync and a default share config; no automatic disk operations.
  - `docker`: kernel/package; source build, ext4 combined only; conflicts with squashfs.
  - `wan-eth0`: file/board; explicit WAN=eth0 and LAN=remaining ports; conflicts with the default WAN mapping and with `switch-port`.
  - `switch-port`: file/board; explicit WAN port and LAN port list from the target's declared port map; conflicts with `wan-eth0`.
  - `ipv6`: file/network; typed LAN/WAN IPv6 mode (disabled, DHCPv6 client, RA/SLAAC, relay); no arbitrary `ip6tables` input.
  - `pppoe`: file/network; WAN PPPoE credentials and options; credentials are per-build secrets and never enter logs or the source offer.
  - `wifi`: file/network; SSID, key, country, channel and band; requires a radio-capable target or an explicit `usb-wifi` overlay, and is experimental on x86.
  - `webserver-uhttpd` / `webserver-nginx` / `webserver-lighttpd`: mutually exclusive.
  - `https-selfsigned`: file; per-build certificate and key, never logged or source-offered.
  - `usb-wired`, `usb-wifi`, `wwan`: package/kmod; offered only where the capability registry allows, labelled experimental, no hardware guarantee.
  - `bypass`: file; disables the DHCP server, sets gateway/DNS and optional source-IP rules; conflicts with a DHCP-server mode.
- The base network section is typed, not free-form UCI: LAN IPv4 address/netmask, DHCP server on/off with range/lease, WAN protocol (DHCP, static, PPPoE), DNS, IPv6 mode and WiFi values. Modes may set these fields; they may not inject arbitrary `uci` commands.
- Theme selection is not a mode. A theme is an extension-feed package plus metadata (preview, supported LuCI version, default flag); the selected theme is a plan input and the package is resolved through the normal extension/bundle path.
- Custom files and custom signing keys are out of V2.0. They bypass the controlled-output and auditable-signing boundaries and will be reconsidered after the source-offer and signing model is stable.
- Kernel lines are 6.6, 6.12 and 6.18. 6.12 is the V2.0 default and release gate; 6.6 and 6.18 are experimental builds.
- Source builds run on GitHub-hosted runners in V2.0 and must fit the six-hour job limit with SDK/toolchain and compiler caches. Self-hosted runners are a later option, not an assumption.

## Consequences

- Mode conflicts and requirements are part of the plan contract, so they are testable without running a build.
- A preset that needs kernel configuration declares the source-build requirement; ImageBuilder-only plans must reject it.
- Experimental presets need explicit labels in the UI and cannot be counted as V2.0 acceptance evidence.
- The capability registry is the authority for which presets and kernel lines a target can offer.
