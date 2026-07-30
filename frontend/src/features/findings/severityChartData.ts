const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info', 'none'];

export function buildSeverityChartData(counts: { severity: string; count: number }[]) {
  const totals = new Map<string, number>();
  for (const entry of counts) {
    const severity = entry.severity.toLowerCase();
    totals.set(severity, (totals.get(severity) ?? 0) + entry.count);
  }

  return SEVERITY_ORDER.map((severity) => {
    return {
      severity: severity.charAt(0).toUpperCase() + severity.slice(1),
      count: totals.get(severity) ?? 0,
      key: severity,
    };
  }).filter((entry) => entry.count > 0);
}
