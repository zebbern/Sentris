import type { FindingProjectionHealth, FindingSchemaCoverage } from '@/services/api/findings';

export interface FindingDataQuality {
  availability: 'available' | 'degraded';
  projectionHealth?: FindingProjectionHealth;
  schemaCoverage: FindingSchemaCoverage;
}

export function humanizeProjectionReason(reason: string): string {
  return reason.replace(/_/g, ' ');
}

export function shouldShowFindingDataQuality(data: FindingDataQuality): boolean {
  return (
    data.availability === 'degraded' ||
    data.schemaCoverage.legacy > 0 ||
    data.schemaCoverage.invalid > 0
  );
}

export function describeFindingDataQuality(data: FindingDataQuality): string {
  const parts = [`Data availability is ${data.availability}.`];
  if (data.projectionHealth?.reason) {
    parts.push(`Projection: ${humanizeProjectionReason(data.projectionHealth.reason)}.`);
  }
  const { canonical, legacy, invalid } = data.schemaCoverage;
  parts.push(`Schema coverage: ${canonical} canonical, ${legacy} legacy, ${invalid} invalid.`);
  return parts.join(' ');
}
