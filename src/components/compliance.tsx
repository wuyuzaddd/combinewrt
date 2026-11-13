import type { ComplianceIssue } from "@/lib/compliance";

const REASON_LABELS: Record<ComplianceIssue["reason"], string> = {
  proprietary: "标记为 proprietary",
  "unknown-license": "缺少许可证声明",
};

export function describeComplianceIssue(issue: ComplianceIssue): string {
  return `${REASON_LABELS[issue.reason]}${issue.license ? `（${issue.license}）` : ""}`;
}

export function ComplianceIssueList({
  issues,
  className,
}: {
  issues: ComplianceIssue[];
  className?: string;
}) {
  return (
    <ul className={className}>
      {issues.map((issue) => (
        <li key={`${issue.name}-${issue.reason}`}>
          <span className="font-mono">{issue.name}</span> {describeComplianceIssue(issue)}
        </li>
      ))}
    </ul>
  );
}
