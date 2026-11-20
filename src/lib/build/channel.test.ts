import { describe, expect, it } from "vitest";
import {
  channelForVersion,
  isBaseVersionShape,
  isReleaseVersion,
  isSnapshotVersion,
  resolveChannel,
} from "./channel";

describe("base-version channels", () => {
  it.each(["25.12.2", "24.10.0", "1.2.3"])("accepts release version %s", (version) => {
    expect(isReleaseVersion(version)).toBe(true);
    expect(isSnapshotVersion(version)).toBe(false);
    expect(isBaseVersionShape(version)).toBe(true);
    expect(channelForVersion(version)).toBe("release");
  });

  it.each(["24.10-SNAPSHOT", "25.12.3-snapshot", "25.12-SNAPSHOT"])("accepts snapshot version %s", (version) => {
    expect(isReleaseVersion(version)).toBe(false);
    expect(isSnapshotVersion(version)).toBe(true);
    expect(isBaseVersionShape(version)).toBe(true);
    expect(channelForVersion(version)).toBe("snapshot");
  });

  it.each(["", "25.12", "v25.12.2", "25.12.2-SNAPSHOT2", "snapshot", "25.12.2.1", "../25.12.2"])(
    "rejects malformed version %s",
    (version) => {
      expect(isBaseVersionShape(version)).toBe(false);
    },
  );

  it("takes the channel from the BaseVersion record before the version shape", () => {
    // A record may mark a release-shaped version as a snapshot.
    expect(resolveChannel("25.12.2", { channel: "snapshot" })).toBe("snapshot");
    expect(resolveChannel("25.12.2", { channel: "release" })).toBe("release");
  });

  it("never downgrades a snapshot version to release on a stale record", () => {
    expect(resolveChannel("24.10-SNAPSHOT", { channel: "release" })).toBe("snapshot");
    expect(resolveChannel("24.10-SNAPSHOT", null)).toBe("snapshot");
    expect(resolveChannel("25.12.2")).toBe("release");
  });
});
