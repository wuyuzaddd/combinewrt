# Preset package feeds for the installed system

Images will contain an **image feed set**: the apk repositories and public keys that the running system uses for later package installation. This is separate from build-time package resolution and carries its own reproducibility and trust rules.

## Decision

- Keep the ImageBuilder-generated `/etc/apk/repositories.d/distfeeds.list` unchanged. Add project feeds in `/etc/apk/repositories.d/90-combinewrt.list` so an upstream feed can be inspected or removed without rewriting the image's base configuration.
- The official ImmortalWrt feeds stay canonical at `https://downloads.immortalwrt.org`, with an optional mirror URL override. The feed set is pinned to the build's exact base version; it never points at a rolling release channel.
- Public images get official feeds plus the signed supplement feed and, when the plan selected extension packages, the signed extension feed. Private images get the same plus an explicit dllkids path.
- Supplement and extension are separate signed indexes on one distribution site, published under version-frozen paths, e.g. `/supplement/25.12.2/x86_64/packages.adb` and `/extension/25.12.2/x86_64/packages.adb`. Both use the project public key at `/etc/apk/keys/combinewrt-feed.pub.pem` but keep separate pins and contents. The source offer records each URL, index sha256 and key fingerprint.
- dllkids is unsigned: it has no `packages.adb.sig` and no published key directory. It is therefore not added to the global repositories list. Private images get an explicit `apk-dllkids` wrapper that adds the dllkids index with `--allow-untrusted`; the default `apk` command never weakens signature checking for official or supplement feeds.
- A public image must not contain a default untrusted repository. If dllkids is needed in a public image, the only permitted route is a reviewed source recipe that rebuilds and signs the package, not the upstream binary feed.
- The image feed set is recorded in the source offer, including the official base, supplement URL/pin, extension URL/pin where selected, and dllkids URL/pin where present. dllkids has no key fingerprint to record.

## Consequences

- Changing the base version changes the image feed set; it does not silently follow a newer release.
- The feed publisher must retain version-frozen supplement indexes and keys, not only the latest index.
- A user who runs `apk add` gets signed official and supplement feeds by default; installing from dllkids requires the explicit wrapper and is visible as an exception.
- The public-image license gate applies to the supplement feed as well; an image feed set cannot be used to distribute packages the build gate rejected.
