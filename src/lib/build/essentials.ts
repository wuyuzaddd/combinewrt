/**
 * Factory packages every image needs to boot and stay manageable (ticket 08).
 *
 * The negative package list (`removePackages`) is a subtractive operation on
 * the user's selection, never on the base system: removing one of these would
 * produce an image that cannot authenticate, mount over its root or resolve
 * dependencies, so the planner answers 409 and names the package instead of
 * silently ignoring it.
 */
export const ESSENTIAL_PACKAGES: readonly string[] = [
  "apk",
  "base-files",
  "busybox",
  "dropbear",
  "fstools",
  "kernel",
  "libc",
  "libubox",
  "libubus",
  "mtd",
  "netifd",
  "opkg",
  "procd",
  "ubox",
  "ubus",
  "uci",
];

const ESSENTIAL_SET = new Set(ESSENTIAL_PACKAGES);

/** Accepts both a plain name and a `source/name` reference. */
export function isEssentialPackage(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length === 0) return false;
  const plain = trimmed.includes("/") ? trimmed.slice(trimmed.indexOf("/") + 1) : trimmed;
  const withoutVersion = plain.includes("@") ? plain.slice(0, plain.indexOf("@")) : plain;
  return ESSENTIAL_SET.has(withoutVersion);
}
