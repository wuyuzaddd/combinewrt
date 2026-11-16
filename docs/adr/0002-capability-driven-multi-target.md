# Model multiple targets, accept x86_64 first

V2 will model targets, device profiles and image capabilities as data, but V2.0 acceptance is limited to `x86/64` and the `generic` profile. ARM targets remain in the capability registry and are deferred until hardware is available for real verification.

## Why

The build model, catalog and UI would otherwise be tied to x86 and require a second redesign for ARM. At the same time, shipping ARM entries that have never produced a verified image would be a worse claim than delaying them. The registry can describe ARM capabilities without advertising a supported build path.

## Consequences

- Every image choice is validated against a checked-in capability registry, not against hardcoded UI lists.
- CI validates the registry against upstream profiles and ImageBuilder metadata.
- ARM profiles may exist in the registry but are marked unavailable until an acceptance run exists.
- The first ARM target is an implementation decision for a later release, not a V2.0 promise.
