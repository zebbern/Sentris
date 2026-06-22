import type { Finding, FindingSeverity } from './normalizeFindings.js';

const SEVERITY_LABELS: FindingSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];

function escapeCSV(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function severityCounts(findings: Finding[]): Record<FindingSeverity, number> {
  const counts: Record<FindingSeverity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  for (const finding of findings) {
    counts[finding.severity]++;
  }
  return counts;
}

export function formatFindingsCsv(findings: Finding[]): string {
  const header = 'Severity,Type,Finding,Source Node,Source Component';
  const rows = findings.map((finding) =>
    [finding.severity, finding.type, finding.finding, finding.sourceNode, finding.sourceComponent]
      .map(escapeCSV)
      .join(','),
  );
  return [header, ...rows].join('\n');
}

export function formatFindingsMarkdown(findings: Finding[], runId: string | null): string {
  const counts = severityCounts(findings);
  const lines: string[] = [
    '# Findings Report',
    '',
    `- **Run**: ${runId ?? 'N/A'}`,
    `- **Date**: ${new Date().toISOString()}`,
    `- **Total Findings**: ${findings.length}`,
    '',
    '## Summary',
    '',
    '| Severity | Count |',
    '|----------|-------|',
    ...SEVERITY_LABELS.map(
      (severity) => `| ${severity.charAt(0).toUpperCase() + severity.slice(1)} | ${counts[severity]} |`,
    ),
    '',
  ];

  for (const severity of SEVERITY_LABELS) {
    const group = findings.filter((finding) => finding.severity === severity);
    if (group.length === 0) continue;
    lines.push(
      `## ${severity.charAt(0).toUpperCase() + severity.slice(1)} (${group.length})`,
      '',
      '| Type | Finding | Source |',
      '|------|---------|--------|',
    );
    for (const finding of group) {
      lines.push(
        `| ${finding.type} | ${finding.finding.replace(/\|/g, '\\|')} | ${finding.sourceNode} |`,
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function formatFindingsSummaryText(findings: Finding[], limit = 25): string {
  const top = findings.slice(0, limit);
  if (top.length === 0) {
    return 'No findings recorded for completed nodes.';
  }

  return top
    .map(
      (finding, index) =>
        `${index + 1}. [${finding.severity}] ${finding.type}: ${finding.finding} (${finding.sourceNode})`,
    )
    .join('\n');
}
