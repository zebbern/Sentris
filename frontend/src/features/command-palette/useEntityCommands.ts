import { useMemo } from 'react';
import {
  Workflow,
  Box,
  LayoutTemplate,
  CalendarClock,
  KeyRound,
  Shield,
  Webhook,
} from 'lucide-react';
import { useComponents } from '@/hooks/queries/useComponentQueries';
import { useWorkflowsList } from '@/hooks/queries/useWorkflowQueries';
import { useTemplates } from '@/hooks/queries/useTemplateQueries';
import { useSchedules } from '@/hooks/queries/useScheduleQueries';
import { useSecrets } from '@/hooks/queries/useSecretQueries';
import { useApiKeys } from '@/hooks/queries/useApiKeyQueries';
import { useWebhooks } from '@/hooks/queries/useWebhookQueries';
import { env } from '@/config/env';
import { WorkflowMetadataSchema } from '@/schemas/workflow';
import type { ComponentMetadata } from '@/schemas/component';
import type { Command } from './command-palette-types';

interface UseEntityCommandsResult {
  workflowCommands: Command[];
  componentCommands: Command[];
  templateCommands: Command[];
  scheduleCommands: Command[];
  secretCommands: Command[];
  apiKeyCommands: Command[];
  webhookCommands: Command[];
  allComponents: ComponentMetadata[];
  isLoadingWorkflows: boolean;
  isLoadingComponents: boolean;
}

export function useEntityCommands(isOpen: boolean): UseEntityCommandsResult {
  const { data: componentIndex, isLoading: isLoadingComponents } = useComponents();
  const storeComponents = componentIndex?.byId ?? {};
  const { data: rawWorkflows = [], isLoading: isLoadingWorkflows } = useWorkflowsList();
  const { data: templates = [] } = useTemplates(undefined, { enabled: isOpen });
  const { data: schedules = [] } = useSchedules(undefined, { enabled: isOpen });
  const { data: secrets = [] } = useSecrets({ enabled: isOpen });
  const { data: apiKeys = [] } = useApiKeys({ enabled: isOpen });
  const { data: webhooks = [] } = useWebhooks({ enabled: isOpen });

  const workflows = useMemo(
    () => rawWorkflows.map((w) => WorkflowMetadataSchema.parse(w)),
    [rawWorkflows],
  );

  // Filter out demo, test, and entry-point components (same logic as Sidebar)
  const allComponents = useMemo(() => {
    const components = Object.values(storeComponents);
    return components.filter((component) => {
      if (component.id === 'core.workflow.entrypoint' || component.slug === 'entry-point') {
        return false;
      }
      if (!env.VITE_ENABLE_IT_OPS && component.category === 'it_ops') {
        return false;
      }
      const name = component.name.toLowerCase();
      const slug = component.slug.toLowerCase();
      const category = component.category.toLowerCase();
      const id = component.id.toLowerCase();
      if (
        category === 'demo' ||
        name.includes('demo') ||
        slug.includes('demo') ||
        name.includes('(test)') ||
        name === 'live event' ||
        name === 'parallel sleep' ||
        slug === 'live-event' ||
        slug === 'parallel-sleep' ||
        id.startsWith('test.') ||
        id === 'docker-echo'
      ) {
        return false;
      }
      return true;
    });
  }, [storeComponents]);

  const workflowCommands = useMemo<Command[]>(
    () =>
      workflows.map((workflow) => ({
        id: `workflow-${workflow.id}`,
        type: 'workflow' as const,
        label: workflow.name,
        description: `Open workflow · ${workflow.nodes.length} nodes`,
        category: 'workflows' as const,
        icon: Workflow,
        workflowId: workflow.id,
        keywords: [workflow.name.toLowerCase(), 'workflow', 'open'],
      })),
    [workflows],
  );

  const componentCommands = useMemo<Command[]>(
    () =>
      allComponents.map((component) => ({
        id: `component-${component.id}`,
        type: 'component' as const,
        label: component.name,
        description: component.description || `Add ${component.name} to canvas`,
        category: 'components' as const,
        icon: Box,
        iconName: component.icon || undefined,
        iconUrl: component.logo || undefined,
        componentId: component.id,
        componentName: component.name,
        keywords: [
          component.name.toLowerCase(),
          component.slug.toLowerCase(),
          component.category.toLowerCase(),
          'component',
          'add',
          'node',
          ...(component.description?.toLowerCase().split(' ') || []),
        ],
      })),
    [allComponents],
  );

  const templateCommands = useMemo<Command[]>(
    () =>
      templates.map((t) => ({
        id: `template-${t.id}`,
        type: 'navigation' as const,
        label: t.name,
        description: t.description || `Template · ${t.category ?? 'General'}`,
        category: 'templates' as const,
        icon: LayoutTemplate,
        keywords: [
          t.name.toLowerCase(),
          'template',
          ...(t.category ? [t.category.toLowerCase()] : []),
          ...(t.tags ?? []).map((tag) => tag.toLowerCase()),
        ],
        href: `/templates?id=${t.id}`,
      })),
    [templates],
  );

  const scheduleCommands = useMemo<Command[]>(
    () =>
      schedules.map((s) => ({
        id: `schedule-${s.id}`,
        type: 'navigation' as const,
        label: s.name,
        description: `${s.cronExpression} · ${s.status}`,
        category: 'schedules' as const,
        icon: CalendarClock,
        keywords: [s.name.toLowerCase(), 'schedule', 'cron', s.cronExpression, s.status],
        href: `/schedules?highlight=${s.id}`,
      })),
    [schedules],
  );

  const secretCommands = useMemo<Command[]>(
    () =>
      secrets.map((s) => ({
        id: `secret-${s.id}`,
        type: 'navigation' as const,
        label: s.name,
        description: s.description || 'Secret',
        category: 'secrets' as const,
        icon: KeyRound,
        keywords: [s.name.toLowerCase(), 'secret', 'credential'],
        href: '/secrets',
      })),
    [secrets],
  );

  const apiKeyCommands = useMemo<Command[]>(
    () =>
      apiKeys.map((k) => ({
        id: `apikey-${k.id}`,
        type: 'navigation' as const,
        label: k.name,
        description: k.description || `API Key · ${k.keyHint}`,
        category: 'api-keys' as const,
        icon: Shield,
        keywords: [k.name.toLowerCase(), 'api', 'key', k.keyHint],
        href: '/api-keys',
      })),
    [apiKeys],
  );

  const webhookCommands = useMemo<Command[]>(
    () =>
      webhooks.map((w) => ({
        id: `webhook-${w.id}`,
        type: 'navigation' as const,
        label: w.name,
        description: `Webhook · ${w.status}`,
        category: 'webhooks' as const,
        icon: Webhook,
        keywords: [w.name.toLowerCase(), 'webhook', 'hook', w.status],
        href: `/webhooks?id=${w.id}`,
      })),
    [webhooks],
  );

  return {
    workflowCommands,
    componentCommands,
    templateCommands,
    scheduleCommands,
    secretCommands,
    apiKeyCommands,
    webhookCommands,
    allComponents,
    isLoadingWorkflows,
    isLoadingComponents,
  };
}
