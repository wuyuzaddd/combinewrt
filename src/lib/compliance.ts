import type { ResolvedEntry } from "./build/types";

export type ComplianceReason = "proprietary" | "unknown-license";

export interface ComplianceIssue {
  name: string;
  version: string | null;
  packageSource: string | null;
  license: string | null;
  reason: ComplianceReason;
}

export interface ComplianceReport {
  publicEligible: boolean;
  issues: ComplianceIssue[];
}

type LicenseInput = Pick<ResolvedEntry, "license" | "proprietary">;

/**
 * A package is safe for a public image only when its feed metadata declares a
 * concrete license and does not mark it proprietary. Missing license metadata
 * is treated as restricted: catalog data is upstream-controlled, so absence is
 * not permission.
 */
export function complianceReason(input: LicenseInput): ComplianceReason | null {
  if (!input.license || input.license.trim() === "") return "unknown-license";
  if (input.proprietary) return "proprietary";
  return null;
}

export function createComplianceReport(entries: ResolvedEntry[]): ComplianceReport {
  const issues: ComplianceIssue[] = [];
  for (const entry of entries) {
    const reason = complianceReason(entry);
    if (!reason) continue;
    issues.push({
      name: entry.name,
      version: entry.version,
      packageSource: entry.packageSource,
      license: entry.license ?? null,
      reason,
    });
  }
  return { publicEligible: issues.length === 0, issues };
}
