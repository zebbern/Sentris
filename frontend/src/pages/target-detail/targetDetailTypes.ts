export const TARGET_DETAIL_TABS = ['overview', 'runs'] as const;

export type TargetDetailTab = (typeof TARGET_DETAIL_TABS)[number];
