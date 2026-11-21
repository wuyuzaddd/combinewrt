import { describe, expect, it } from "vitest";
import { loadCapabilities } from "@/lib/catalog/capabilities";
import { loadExtensionBundles } from "@/lib/extension/bundles";
import { loadExtensionThemes } from "@/lib/extension/themes";
import { loadCommonPreset } from "@/lib/presets/common";
import { loadSourceRegistry } from "@/lib/sources/registry";
import { loadModeDeclarations } from "@/lib/build/modes";
import { createBuildUiOptions } from "@/lib/build/ui-options";
import {
  addPackage,
  buildSubmitBody,
  defaultBuildForm,
  expandedPackages,
  releaseOptions,
  removePackage,
  selectTarget,
  selectDefaultTheme,
  toggleThemePackage,
  toggleBundle,
  toggleMode,
  variantFromImageType,
} from "./form-model";

const registry = loadCapabilities();
const sourceRegistry = loadSourceRegistry();
const ui = createBuildUiOptions({
  registry,
  declarations: loadModeDeclarations(),
  bundles: loadExtensionBundles({ registry: sourceRegistry }),
  themes: loadExtensionThemes({ registry: sourceRegistry }),
  common: loadCommonPreset(),
});
const releases = [{ version: "25.12.2", active: true, snapshotAvailable: true }];

describe("defaultBuildForm", () => {
  it("starts in Simple mode on the buildable x86 target with a supported variant", () => {
    const form = defaultBuildForm(ui, releases);
    expect(form.mode).toBe("simple");
    expect(form.targetId).toBe("x86/64");
    expect(form.profileId).toBe("generic");
    expect(form.release).toBe("25.12.2");
    expect(form.kernelLine).toBe("6.12");
    expect(form.variant).toEqual({ boot: "efi", filesystem: "ext4", artifact: "combined" });
    expect(form.basePreset).toBe("minimal");
    expect(form.modes).toEqual([]);
  });

  it("rehydrates a V1 build config into the V2 form", () => {
    const form = defaultBuildForm(ui, releases, {
      profile: "generic",
      imageType: "squashfs-efi",
      hostname: "old-router",
      timezone: "UTC",
      lanIp: "192.168.8.1",
      netmask: "255.255.255.0",
      packages: ["luci"],
    });
    expect(form.hostname).toBe("old-router");
    expect(form.variant).toEqual({ boot: "efi", filesystem: "squashfs", artifact: "combined" });
    expect(form.packages).toEqual(["luci"]);
  });

  it("maps the V1 catalog image formats", () => {
    expect(variantFromImageType("ext4-efi")).toEqual({ boot: "efi", filesystem: "ext4", artifact: "combined" });
    expect(variantFromImageType("rootfs-tar")).toEqual({ boot: "efi", filesystem: "squashfs", artifact: "rootfs" });
    expect(variantFromImageType("weird")).toBeNull();
  });
});

describe("selection transitions", () => {
  it("re-derives profile, kernel and variant when the target changes", () => {
    const form = selectTarget(defaultBuildForm(ui, releases), ui, "mediatek/filogic");
    expect(form.profileId).toBe("generic");
    expect(form.kernelLine).toBe("6.12");
    // A placeholder target has no supported variant; the form keeps a safe
    // default and the Advanced view shows the placeholder reason instead.
    expect(form.variant.artifact).toBe("combined");
  });

  it("adds and removes manual packages", () => {
    let form = addPackage(defaultBuildForm(ui, releases), "luci");
    form = addPackage(form, "luci");
    expect(form.packages).toEqual(["luci"]);
    form = removePackage(form, "luci");
    expect(form.packages).toEqual([]);
  });

  it("expands a bundle and removes only packages it still owns", () => {
    const bundle = ui.bundles.find((item) => item.id === "proxy-openclash-tun")!;
    let form = toggleBundle(defaultBuildForm(ui, releases), ui, bundle);
    expect(form.bundles).toEqual([bundle.id]);
    expect(form.packages).toEqual(expect.arrayContaining(bundle.packages));
    // A manually added package that the bundle also contains stays after toggling.
    form = addPackage(form, "luci");
    form = toggleBundle(form, ui, bundle);
    expect(form.packages).toEqual(["luci"]);
  });

  it("installs several themes and applies exactly one of them", () => {
    let form = toggleThemePackage(defaultBuildForm(ui, releases), "luci-theme-argon");
    form = toggleThemePackage(form, "luci-theme-aurora");
    expect(form.packages).toEqual(["luci-theme-argon", "luci-theme-aurora"]);
    expect(form.defaultTheme).toBeNull();

    form = selectDefaultTheme(form, "luci-theme-aurora");
    expect(form.defaultTheme).toBe("luci-theme-aurora");
    expect(buildSubmitBody(form, ui, "pw").theme).toBe("luci-theme-aurora");

    // Uninstalling the applied theme clears the default instead of leaving a
    // dangling package name behind.
    form = toggleThemePackage(form, "luci-theme-aurora");
    expect(form.defaultTheme).toBeNull();
    expect(form.packages).toEqual(["luci-theme-argon"]);
  });

  it("refuses to apply a theme that is not installed", () => {
    const form = defaultBuildForm(ui, releases);
    expect(selectDefaultTheme(form, "luci-theme-aurora").defaultTheme).toBeNull();
  });

  it("toggles overlay modes without duplicates", () => {
    let form = toggleMode(defaultBuildForm(ui, releases), "nas");
    expect(form.modes).toEqual(["nas"]);
    form = toggleMode(form, "nas");
    expect(form.modes).toEqual([]);
  });
});

describe("buildSubmitBody", () => {
  it("emits the V2 triple, mode refs and no network section in Simple mode", () => {
    const body = buildSubmitBody(defaultBuildForm(ui, releases), ui, "root-password");
    expect(body.schemaVersion).toBe(2);
    expect(body.target).toBe("x86/64");
    expect(body.profile).toBe("generic");
    expect(body.baseVersion).toBe("25.12.2");
    expect(body.kernelLine).toBe("6.12");
    expect(body.imageVariant).toMatchObject({ boot: "efi", filesystem: "ext4", artifact: "combined" });
    expect(body.basePreset).toBe("minimal");
    expect(body.modes).toEqual([]);
    expect(body.network).toBeUndefined();
    expect(body.rootPassword).toBe("root-password");
  });

  it("includes the typed network and mode layers in Advanced mode", () => {
    const form = { ...defaultBuildForm(ui, releases), mode: "advanced" as const, modes: ["pppoe", "ipv6"] };
    const body = buildSubmitBody(form, ui, "root-password");
    expect(body.network).toBeDefined();
    expect(body.modes).toEqual([
      { id: "pppoe", layer: "file/board", title: "PPPoE WAN" },
      { id: "ipv6", layer: "file/board", title: "IPv6" },
    ]);
    expect((body.imageVariant as { overlaySizeMb?: number }).overlaySizeMb).toBe(1024);
  });

  it("omits the overlay size for a rootfs tarball", () => {
    const form = {
      ...defaultBuildForm(ui, releases),
      variant: { boot: "efi" as const, filesystem: "squashfs" as const, artifact: "rootfs" as const },
    };
    const body = buildSubmitBody(form, ui, "root-password");
    expect(body.imageVariant).not.toHaveProperty("overlaySizeMb");
  });

  it("expands selected bundles for the preview without mutating packages", () => {
    const bundle = ui.bundles.find((item) => item.id === "system-store")!;
    const form = toggleBundle(defaultBuildForm(ui, releases), ui, bundle);
    expect(expandedPackages(form, ui)).toEqual(expect.arrayContaining(bundle.packages));
    expect(form.packages).toEqual(expect.arrayContaining(bundle.packages));
  });
});

describe("releaseOptions (ticket 11)", () => {
  it("offers only release-channel base versions", () => {
    const options = releaseOptions(
      [
        { version: "25.12.2", channel: "release" },
        { version: "24.10-SNAPSHOT", channel: "snapshot" },
        { version: "25.13.0", channel: "release" },
      ],
      "25.12.2",
      "25.12.2",
    );

    expect(options.map((option) => option.version)).toEqual(["25.12.2", "25.13.0"]);
    expect(options.every((option) => option.channel === "release")).toBe(true);
    expect(options.find((option) => option.active)?.version).toBe("25.12.2");
  });

  it("excludes a release-shaped row that its record marks as a snapshot", () => {
    const options = releaseOptions(
      [
        { version: "25.12.2", channel: "release" },
        { version: "25.12.3", channel: "snapshot" },
      ],
      "25.12.2",
      "25.12.2",
    );
    expect(options.map((option) => option.version)).toEqual(["25.12.2"]);
  });

  it("falls back to the active snapshot row and labels it experimental", () => {
    const options = releaseOptions(
      [{ version: "24.10-SNAPSHOT", channel: "snapshot" }],
      "24.10-SNAPSHOT",
      "24.10-SNAPSHOT",
    );
    expect(options).toEqual([
      { version: "24.10-SNAPSHOT", active: true, snapshotAvailable: true, channel: "snapshot" },
    ]);
  });

  it("falls back to the catalog base version when no base row exists", () => {
    expect(releaseOptions([], "25.12.2", "25.12.2")).toEqual([
      { version: "25.12.2", active: true, snapshotAvailable: true, channel: "release" },
    ]);
  });
});
