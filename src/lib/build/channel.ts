import type { BaseChannel } from "../domain/types";

/**
 * Base-version channels (ticket 11).
 *
 * A release is an ImmortalWrt stable tag such as `25.12.2`; a snapshot is a
 * rolling base version such as `24.10-SNAPSHOT` or `25.12.3-snapshot`. Both
 * shapes are legal plan inputs, but they do not mean the same thing: a
 * snapshot build is experimental and never publicly distributable by default.
 *
 * The channel of a plan derives from the selected `BaseVersion` record. The
 * version string is only a fallback for a caller with no record (tests, stored
 * plans, V1 compatibility), so the hard-coded `"release"` default is gone.
 */
export const RELEASE_VERSION = /^\d+\.\d+\.\d+$/;
export const SNAPSHOT_VERSION = /^\d+\.\d+(?:\.\d+)?-snapshot$/i;

export function isReleaseVersion(version: string): boolean {
  return RELEASE_VERSION.test(version.trim());
}

export function isSnapshotVersion(version: string): boolean {
  return SNAPSHOT_VERSION.test(version.trim());
}

/** True for every base-version shape the V2 form accepts. */
export function isBaseVersionShape(version: string): boolean {
  return isReleaseVersion(version) || isSnapshotVersion(version);
}

/** Channel implied by a version string alone. */
export function channelForVersion(version: string): BaseChannel {
  return isSnapshotVersion(version) ? "snapshot" : "release";
}

/**
 * Channel of a plan. The `BaseVersion` row is authoritative (it may mark an
 * otherwise release-shaped version as a snapshot), but a snapshot version can
 * never be downgraded to release by a stale record: the safe direction wins.
 */
export function resolveChannel(
  version: string,
  record?: { channel?: BaseChannel } | null,
): BaseChannel {
  return record?.channel === "snapshot" || isSnapshotVersion(version) ? "snapshot" : "release";
}
