import { rmSync } from "node:fs";
import { migrate, openDatabase } from "../src/lib/db";
import { createCatalogStore } from "../src/lib/catalog/store";
import { createBaseVersionStore } from "../src/lib/base/store";
import { createBuildStore } from "../src/lib/builds/store";
import type { CatalogPackage, CatalogProfile, PackageSource, SourcePins } from "../src/lib/catalog/types";

const dbPath = process.env.DATABASE_PATH ?? "/tmp/combinewrt-e2e.db";
for (const suffix of ["", "-wal", "-shm"]) rmSync(`${dbPath}${suffix}`, { force: true });

const db = openDatabase(dbPath);
migrate(db);

const pins: SourcePins = {
  official: { luci: "official-luci-pin", packages: "official-packages-pin", kmods: "official-kmods-pin" },
  dllkids: "dllkids-index-sha",
  supplement: { commit: "18b7d51c1a06427fa6e8c64b161869de7daded7e", fingerprint: "f71286670f3cc138ec4f55e650c6aa4ed2bd7fff7d29851aef2ac53bae72d083", indexSha256: "c4851521cffc6bc177cb9e0cc887c3e87a0bc5f15bf9bc4d3f0e63c8f3e30c32" },
  kernel: { version: "6.12.103", release: "1", vermagic: "0413601b1c3f0490e17f340fe09229ea" },
};

function pkg(
  name: string,
  source: PackageSource,
  feed: string,
  sourcePin: string,
  overrides: Partial<CatalogPackage> = {},
): CatalogPackage {
  return {
    name,
    version: "1.0.0-r1",
    arch: "x86_64",
    description: `${name} e2e fixture`,
    license: "MIT",
    origin: `feeds/${feed}/${name}`,
    category: feed,
    installedSize: 1024,
    depends: [],
    feed,
    proprietary: false,
    source,
    sourcePin,
    sha256: source === "official" ? null : `${name}-package-hash`,
    fileSize: 2048,
    filename: source === "official" ? null : `${name}-1.0.0-r1.apk`,
    downloadUrl: source === "official" ? null : `https://example.invalid/${name}-1.0.0-r1.apk`,
    kmod: name.startsWith("kmod-"),
    ...overrides,
  };
}

const packages: CatalogPackage[] = [
  pkg("luci", "official", "luci", pins.official.luci),
  pkg("libc", "official", "packages", pins.official.packages),
  pkg("dnsmasq", "official", "packages", pins.official.packages),
  pkg("dnsmasq-full", "official", "packages", pins.official.packages),
  pkg("kmod-e2e", "official", "kmods", pins.official.kmods, { kmod: true }),
  pkg("dual-package", "official", "packages", pins.official.packages),
  pkg("dual-package", "dllkids", "dllkids", pins.dllkids!),
  pkg("lucky", "dllkids", "dllkids", pins.dllkids!, { version: "3.5.0-r1", license: "GPL-3.0-only" }),
  pkg("luci-app-lucky", "dllkids", "dllkids", pins.dllkids!, {
    version: "27.307.42643~21d6884",
    license: "Apache-2.0",
    depends: ["lucky"],
  }),
  pkg("kmod-demo", "dllkids", "dllkids", pins.dllkids!, { kmod: true }),
  pkg("luci-app-store", "supplement", "supplement", pins.supplement!.indexSha256!, {
    version: "0.2.1-r1",
    license: "MIT",
  }),
];

const profiles: CatalogProfile[] = [
  { id: "generic", title: "Generic x86_64", formats: ["ext4-efi", "squashfs-efi", "rootfs-tar"], imageCount: 3 },
];

createCatalogStore(db).saveSnapshot({
  baseVersion: "25.12.2",
  feedCommit: "e2e-fixture",
  sourceNote: "offline e2e fixture (official + dllkids + supplement)",
  sourcePins: pins,
  profiles,
  packages,
});

createBaseVersionStore(db).setActive("25.12.2");

createBuildStore(db).create({
  id: "missing-artifact",
  plan: {
    baseVersion: "25.12.2",
    feedCommit: "e2e-fixture",
    sourceNote: "offline e2e fixture",
    profileId: "generic",
    profileTitle: "Generic x86_64",
    imageType: "ext4-efi",
    packages: ["luci"],
    resolved: [{ name: "luci", version: "1.0.0-r1", source: "selected", packageSource: "official", sourcePin: pins.official.luci, sha256: null, feed: "luci" }],
    topLevelPackages: ["luci"],
    downloads: [],
    sourcePins: pins,
    missingDependencies: [],
    conflicts: [],
    files: [],
    artifactName: "immortalwrt-25.12.2-x86-64-generic-ext4-combined-efi.img.gz",
    imageBuilderCommand: "make image",
    createdAt: "2026-11-15T00:00:00.000Z",
  },
  status: "succeeded",
  runId: "fake-run-missing",
  adapter: "fake",
  logTail: "[stub] image built",
  error: null,
  artifactName: null,
  createdAt: "2026-11-15T00:00:00.000Z",
  updatedAt: "2026-11-15T00:00:00.000Z",
});
db.close();
console.log(`seeded ${dbPath} with ${packages.length} packages`);
