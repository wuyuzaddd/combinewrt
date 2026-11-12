import type { PackageSource } from "../catalog/types";
import type { RequestedPackage } from "./types";

const PACKAGE_REF =
  /^(?:(official|dllkids|supplement)\/)?([A-Za-z0-9][A-Za-z0-9+._-]*)(?:@([A-Za-z0-9+._~-]+))?$/;

export function parsePackageRef(raw: string): RequestedPackage | null {
  const match = PACKAGE_REF.exec(raw.trim());
  if (!match) return null;
  return {
    name: match[2],
    source: (match[1] as PackageSource | undefined) ?? undefined,
    version: match[3] || undefined,
  };
}

