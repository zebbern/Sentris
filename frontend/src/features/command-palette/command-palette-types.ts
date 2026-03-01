import type React from 'react';

// Command types
export type CommandCategory =
  | 'navigation'
  | 'workflows'
  | 'actions'
  | 'settings'
  | 'components'
  | 'templates'
  | 'schedules'
  | 'secrets'
  | 'api-keys'
  | 'webhooks';

export interface BaseCommand {
  id: string;
  label: string;
  description?: string;
  category: CommandCategory;
  icon?: React.ComponentType<{ className?: string }>;
  iconName?: string; // Dynamic lucide icon name (resolved via DynamicIcon)
  iconUrl?: string; // For component logos
  keywords?: string[];
}

export interface NavigationCommand extends BaseCommand {
  type: 'navigation';
  href: string;
}

export interface ActionCommand extends BaseCommand {
  type: 'action';
  action: () => void;
}

export interface WorkflowCommand extends BaseCommand {
  type: 'workflow';
  workflowId: string;
}

export interface ComponentCommand extends BaseCommand {
  type: 'component';
  componentId: string;
  componentName: string;
}

export type Command = NavigationCommand | ActionCommand | WorkflowCommand | ComponentCommand;

// Category labels and order
export const categoryLabels: Record<CommandCategory, string> = {
  navigation: 'Navigation',
  workflows: 'Workflows',
  actions: 'Quick Actions',
  settings: 'Settings',
  components: 'Add Component',
  templates: 'Templates',
  schedules: 'Schedules',
  secrets: 'Secrets',
  'api-keys': 'API Keys',
  webhooks: 'Webhooks',
};

export const categoryOrder: CommandCategory[] = [
  'actions',
  'navigation',
  'workflows',
  'templates',
  'schedules',
  'components',
  'secrets',
  'webhooks',
  'api-keys',
  'settings',
];

export const MAX_RESULTS_PER_CATEGORY = 5;

/** Shape returned by useFilteredCommands for each category group */
export interface CommandGroup {
  category: CommandCategory;
  label: string;
  totalCount: number;
  commands: Command[];
  hasMore: boolean;
}
