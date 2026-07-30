import type { FindingProjectionHealth, FindingSchemaCoverage } from '@/services/api/findings';

export const TARGET_DETAIL_TABS = ['overview', 'runs', 'assets', 'findings'] as const;

export type TargetDetailTab = (typeof TARGET_DETAIL_TABS)[number];

export interface TargetFindingsDataQuality {
  availability: 'available' | 'degraded' | undefined;
  degradedReasons: string[];
  projectionHealth: FindingProjectionHealth | undefined;
  schemaCoverage: FindingSchemaCoverage | undefined;
}
