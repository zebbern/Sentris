export const TARGET_DETAIL_TABS = ['overview', 'runs', 'assets'] as const;

export type TargetDetailTab = (typeof TARGET_DETAIL_TABS)[number];
