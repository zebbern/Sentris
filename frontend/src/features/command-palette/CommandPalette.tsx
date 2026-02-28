import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { DynamicIcon } from '@/components/ui/DynamicIcon';
import { useCommandPaletteStore } from '@/store/commandPaletteStore';
import { useThemeStore } from '@/store/themeStore';
import { useComponents } from '@/hooks/queries/useComponentQueries';
import { useWorkflowsList } from '@/hooks/queries/useWorkflowQueries';
import { useTemplates } from '@/hooks/queries/useTemplateQueries';
import { useSchedules } from '@/hooks/queries/useScheduleQueries';
import { useSecrets } from '@/hooks/queries/useSecretQueries';
import { useApiKeys } from '@/hooks/queries/useApiKeyQueries';
import { useWebhooks } from '@/hooks/queries/useWebhookQueries';
import { useWorkflowUiStore } from '@/store/workflowUiStore';
import { useWorkflowStore } from '@/store/workflowStore';
import { usePlacementStore } from '@/components/layout/sidebar-state';
import { cn } from '@/lib/utils';
import {
  Workflow,
  KeyRound,
  Shield,
  CalendarClock,
  Archive,
  Plug,
  Plus,
  Sun,
  Moon,
  Search,
  ArrowRight,
  Hash,
  CornerDownLeft,
  Box,
  Puzzle,
  Webhook,
  Zap,
  ServerCog,
  LayoutTemplate,
} from 'lucide-react';
import { env } from '@/config/env';
import { WorkflowMetadataSchema } from '@/schemas/workflow';
import type { ComponentMetadata } from '@/schemas/component';

// Command types
type CommandCategory =
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

interface BaseCommand {
  id: string;
  label: string;
  description?: string;
  category: CommandCategory;
  icon?: React.ComponentType<{ className?: string }>;
  iconName?: string; // Dynamic lucide icon name (resolved via DynamicIcon)
  iconUrl?: string; // For component logos
  keywords?: string[];
}

interface NavigationCommand extends BaseCommand {
  type: 'navigation';
  href: string;
}

interface ActionCommand extends BaseCommand {
  type: 'action';
  action: () => void;
}

interface WorkflowCommand extends BaseCommand {
  type: 'workflow';
  workflowId: string;
}

interface ComponentCommand extends BaseCommand {
  type: 'component';
  componentId: string;
  componentName: string;
}

type Command = NavigationCommand | ActionCommand | WorkflowCommand | ComponentCommand;

// Category labels and order
const categoryLabels: Record<CommandCategory, string> = {
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

const categoryOrder: CommandCategory[] = [
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

const MAX_RESULTS_PER_CATEGORY = 5;

/** Score how well `text` matches a search `term`. Higher = better. 0 = no match. */
function scoreMatch(text: string, term: string): number {
  const lower = text.toLowerCase();
  if (lower === term) return 100;
  if (lower.startsWith(term)) return 80;
  // Word boundary match (e.g. "cron" matches "my-cron-job")
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`\\b${escaped}`).test(lower)) return 70;
  if (lower.includes(term)) return 60;
  return 0;
}

/** Score a command against multiple search terms. All terms must match. */
function scoreCommand(
  cmd: { label: string; description?: string; keywords?: string[] },
  terms: string[],
): number {
  let total = 0;
  for (const term of terms) {
    const labelScore = scoreMatch(cmd.label, term);
    const descScore = scoreMatch(cmd.description ?? '', term) * 0.8;
    const kwScores = (cmd.keywords ?? []).map((kw) => scoreMatch(kw, term) * 0.9);
    const best = Math.max(labelScore, descScore, ...kwScores);
    if (best === 0) return 0; // every term must match somewhere
    total += best;
  }
  return total;
}

export function CommandPalette() {
  const { isOpen, close } = useCommandPaletteStore();
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, startTransition } = useThemeStore();
  const { data: componentIndex, isLoading: componentsLoading } = useComponents();
  const storeComponents = componentIndex?.byId ?? {};
  const mode = useWorkflowUiStore((state) => state.mode);
  const { data: rawWorkflows = [], isLoading: isLoadingWorkflows } = useWorkflowsList();
  const { data: templates = [] } = useTemplates(undefined, { enabled: isOpen });
  const { data: schedules = [] } = useSchedules(undefined, { enabled: isOpen });
  const { data: secrets = [] } = useSecrets({ enabled: isOpen });
  const { data: apiKeys = [] } = useApiKeys({ enabled: isOpen });
  const { data: webhooks = [] } = useWebhooks({ enabled: isOpen });
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const initialMountRef = useRef(true);

  // Check if we're on a workflow builder page
  const isOnWorkflowPage =
    location.pathname.startsWith('/workflows/') && location.pathname !== '/workflows/new';
  const isOnNewWorkflowPage = location.pathname === '/workflows/new';
  const canPlaceComponents = (isOnWorkflowPage || isOnNewWorkflowPage) && mode === 'design';

  // Reset state when opening
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      // Focus input after a short delay for animation
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  const workflows = useMemo(
    () => rawWorkflows.map((w) => WorkflowMetadataSchema.parse(w)),
    [rawWorkflows],
  );

  // Components are auto-fetched by useComponents() - no manual fetch needed

  // Get all components (filtered same as Sidebar)
  // Depend on storeComponents to re-render when they're loaded
  const allComponents = useMemo(() => {
    const components = Object.values(storeComponents);
    return components.filter((component) => {
      // Filter out entry point
      if (component.id === 'core.workflow.entrypoint' || component.slug === 'entry-point') {
        return false;
      }
      // Filter out IT ops if disabled
      if (!env.VITE_ENABLE_IT_OPS && component.category === 'it_ops') {
        return false;
      }
      // Filter out demo components
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

  // Handle component placement
  const setPlacement = usePlacementStore((state) => state.setPlacement);
  const currentWorkflowId = useWorkflowStore((state) => state.metadata.id);

  const handleComponentSelect = useCallback(
    (component: ComponentMetadata) => {
      // If not on workflow page, navigate to new workflow first
      if (!isOnWorkflowPage && !isOnNewWorkflowPage) {
        // Navigate to new workflow - user will need to add component after
        navigate('/workflows/new');
        close();
        return;
      }

      // Set up placement state scoped to the current workflow
      // The canvas will detect this and place the component when clicked
      setPlacement(component.id, component.name, currentWorkflowId);

      // Close the command palette
      close();
    },
    [isOnWorkflowPage, isOnNewWorkflowPage, navigate, close, setPlacement, currentWorkflowId],
  );

  // Build static commands
  const staticCommands = useMemo<Command[]>(() => {
    const commands: Command[] = [
      // Quick Actions
      {
        id: 'new-workflow',
        type: 'action',
        label: 'Create New Workflow',
        description: 'Start building a new automation workflow',
        category: 'actions',
        icon: Plus,
        keywords: ['new', 'create', 'add', 'workflow'],
        action: () => {
          navigate('/workflows/new');
          close();
        },
      },
      {
        id: 'toggle-theme',
        type: 'action',
        label: theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode',
        description: 'Toggle between light and dark themes',
        category: 'settings',
        icon: theme === 'dark' ? Sun : Moon,
        keywords: ['theme', 'dark', 'light', 'mode', 'toggle'],
        action: () => {
          startTransition();
          close();
        },
      },
      // Navigation
      {
        id: 'nav-workflows',
        type: 'navigation',
        label: 'Workflows',
        description: 'View and manage your workflows',
        category: 'navigation',
        icon: Workflow,
        keywords: ['workflows', 'list', 'home'],
        href: '/',
      },
      {
        id: 'nav-schedules',
        type: 'navigation',
        label: 'Schedules',
        description: 'Manage workflow schedules',
        category: 'navigation',
        icon: CalendarClock,
        keywords: ['schedules', 'cron', 'timer', 'recurring'],
        href: '/schedules',
      },
      {
        id: 'nav-secrets',
        type: 'navigation',
        label: 'Secrets',
        description: 'Manage API keys and credentials',
        category: 'navigation',
        icon: KeyRound,
        keywords: ['secrets', 'credentials', 'passwords', 'tokens'],
        href: '/secrets',
      },
      {
        id: 'nav-api-keys',
        type: 'navigation',
        label: 'API Keys',
        description: 'Manage your API keys',
        category: 'navigation',
        icon: Shield,
        keywords: ['api', 'keys', 'authentication'],
        href: '/api-keys',
      },
      {
        id: 'nav-artifacts',
        type: 'navigation',
        label: 'Artifact Library',
        description: 'Browse stored artifacts',
        category: 'navigation',
        icon: Archive,
        keywords: ['artifacts', 'files', 'storage', 'library'],
        href: '/artifacts',
      },
      {
        id: 'nav-webhooks',
        type: 'navigation',
        label: 'Webhooks',
        description: 'Manage and debug incoming webhooks',
        category: 'navigation',
        icon: Webhook,
        keywords: ['webhooks', 'hooks', 'triggers', 'incoming'],
        href: '/webhooks',
      },
      {
        id: 'nav-action-center',
        type: 'navigation',
        label: 'Action Center',
        description: 'Review and respond to pending items',
        category: 'navigation',
        icon: Zap,
        keywords: ['action', 'center', 'pending', 'approval', 'review'],
        href: '/action-center',
      },
      {
        id: 'nav-mcp-servers',
        type: 'navigation',
        label: 'MCP Servers',
        description: 'Discover and manage MCP server configurations',
        category: 'navigation',
        icon: ServerCog,
        keywords: ['mcp', 'servers', 'tools', 'configurations'],
        href: '/mcp-library',
      },
    ];

    // Add connections navigation if enabled
    if (env.VITE_ENABLE_CONNECTIONS) {
      commands.push({
        id: 'nav-connections',
        type: 'navigation',
        label: 'Connections',
        description: 'Manage third-party integrations',
        category: 'navigation',
        icon: Plug,
        keywords: ['connections', 'integrations', 'oauth'],
        href: '/integrations',
      });
    }

    return commands;
  }, [theme, navigate, close, startTransition]);

  // Build workflow commands
  const workflowCommands = useMemo<Command[]>(() => {
    return workflows.map((workflow) => ({
      id: `workflow-${workflow.id}`,
      type: 'workflow' as const,
      label: workflow.name,
      description: `Open workflow · ${workflow.nodes.length} nodes`,
      category: 'workflows' as const,
      icon: Workflow,
      workflowId: workflow.id,
      keywords: [workflow.name.toLowerCase(), 'workflow', 'open'],
    }));
  }, [workflows]);

  // Build component commands
  const componentCommands = useMemo<Command[]>(() => {
    return allComponents.map((component) => {
      return {
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
      };
    });
  }, [allComponents]);

  // Build template commands
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

  // Build schedule commands
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

  // Build secret commands
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

  // Build API key commands
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

  // Build webhook commands
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

  // Combine all commands
  const allCommands = useMemo<Command[]>(
    () => [
      ...staticCommands,
      ...workflowCommands,
      ...componentCommands,
      ...templateCommands,
      ...scheduleCommands,
      ...secretCommands,
      ...apiKeyCommands,
      ...webhookCommands,
    ],
    [
      staticCommands,
      workflowCommands,
      componentCommands,
      templateCommands,
      scheduleCommands,
      secretCommands,
      apiKeyCommands,
      webhookCommands,
    ],
  );

  // Filter and score commands based on query
  const filteredCommands = useMemo(() => {
    if (!query.trim()) {
      // Show static commands + limited entity results when no query
      return [
        ...staticCommands,
        ...(canPlaceComponents ? componentCommands.slice(0, MAX_RESULTS_PER_CATEGORY) : []),
        ...workflowCommands.slice(0, MAX_RESULTS_PER_CATEGORY),
      ];
    }

    const terms = query.toLowerCase().split(' ').filter(Boolean);

    return allCommands
      .map((cmd) => ({ cmd, score: scoreCommand(cmd, terms) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.cmd);
  }, [query, allCommands, staticCommands, workflowCommands, componentCommands, canPlaceComponents]);

  // Group commands by category with counts
  const groupedCommands = useMemo(() => {
    const groups = Object.fromEntries(categoryOrder.map((cat) => [cat, [] as Command[]])) as Record<
      CommandCategory,
      Command[]
    >;

    for (const cmd of filteredCommands) {
      groups[cmd.category].push(cmd);
    }

    const hasQuery = query.trim().length > 0;

    return categoryOrder
      .filter((cat) => groups[cat].length > 0)
      .map((cat) => {
        const all = groups[cat];
        return {
          category: cat,
          label: categoryLabels[cat],
          totalCount: all.length,
          commands: hasQuery ? all.slice(0, MAX_RESULTS_PER_CATEGORY) : all,
          hasMore: hasQuery && all.length > MAX_RESULTS_PER_CATEGORY,
        };
      });
  }, [filteredCommands, query]);

  // Flat list for keyboard navigation
  const flatCommandList = useMemo(() => {
    return groupedCommands.flatMap((group) => group.commands);
  }, [groupedCommands]);

  // Clamp selected index
  useEffect(() => {
    if (selectedIndex >= flatCommandList.length) {
      setSelectedIndex(Math.max(0, flatCommandList.length - 1));
    }
  }, [flatCommandList.length, selectedIndex]);

  // Execute command
  const executeCommand = useCallback(
    (command: Command) => {
      switch (command.type) {
        case 'navigation':
          navigate(command.href);
          close();
          break;
        case 'action':
          command.action();
          break;
        case 'workflow':
          navigate(`/workflows/${command.workflowId}`);
          close();
          break;
        case 'component': {
          const component = allComponents.find((c) => c.id === command.componentId);
          if (component) {
            handleComponentSelect(component);
          }
          break;
        }
      }
    },
    [navigate, close, allComponents, handleComponentSelect],
  );

  // Keyboard handling
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, flatCommandList.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (flatCommandList[selectedIndex]) {
            executeCommand(flatCommandList[selectedIndex]);
          }
          break;
        case 'Escape':
          e.preventDefault();
          close();
          break;
      }
    },
    [flatCommandList, selectedIndex, executeCommand, close],
  );

  // Scroll selected item into view
  useEffect(() => {
    const listEl = listRef.current;
    if (!listEl) return;

    const selectedEl = listEl.querySelector('[data-selected="true"]');
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  // Close on location change (skip initial mount to avoid closing on lazy-load)
  useEffect(() => {
    if (initialMountRef.current) {
      initialMountRef.current = false;
      return;
    }
    close();
  }, [location.pathname, close]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent
        className="max-w-2xl p-0 gap-0 overflow-hidden bg-background/95 backdrop-blur-xl border-border/50 shadow-2xl"
        // Hide close button for cleaner look
        onPointerDownOutside={(e) => {
          e.preventDefault();
          close();
        }}
      >
        <DialogTitle className="sr-only">Command Palette</DialogTitle>
        <DialogDescription className="sr-only">
          Search commands, workflows, and navigation
        </DialogDescription>
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50">
          <Search className="w-5 h-5 text-muted-foreground flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder={
              canPlaceComponents
                ? 'Search commands, components, workflows...'
                : 'Search commands, workflows, settings...'
            }
            className="flex-1 bg-transparent border-none outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring text-base placeholder:text-muted-foreground/60"
            aria-label="Search commands"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border border-border/50 bg-muted/50 px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
            ESC
          </kbd>
        </div>

        {/* Command list */}
        <div ref={listRef} className="max-h-[400px] overflow-y-auto overflow-x-hidden">
          {(isLoadingWorkflows || componentsLoading) && query && (
            <div className="px-4 py-3 text-sm text-muted-foreground">Loading...</div>
          )}

          {!isLoadingWorkflows && !componentsLoading && flatCommandList.length === 0 && (
            <div className="px-4 py-8 text-center">
              <Hash className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No results found</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Try a different search term</p>
            </div>
          )}

          {groupedCommands.map((group, groupIndex) => {
            // Calculate starting index for this group
            let startIndex = 0;
            for (let i = 0; i < groupIndex; i++) {
              startIndex += groupedCommands[i].commands.length;
            }

            return (
              <div key={group.category} className="py-2">
                <div className="px-4 py-1.5 flex items-center gap-2">
                  {group.category === 'components' && (
                    <Puzzle className="w-3 h-3 text-muted-foreground/70" />
                  )}
                  <span className="text-xs font-medium text-muted-foreground/70 uppercase tracking-wider">
                    {group.label}
                  </span>
                  {query.trim() && group.totalCount > 0 && (
                    <span className="text-xs text-muted-foreground/50 tabular-nums">
                      ({group.totalCount})
                    </span>
                  )}
                  {group.category === 'components' && !canPlaceComponents && (
                    <span className="text-xs text-muted-foreground/50 normal-case tracking-normal">
                      (open a workflow first)
                    </span>
                  )}
                </div>
                {group.commands.map((command, cmdIndex) => {
                  const flatIndex = startIndex + cmdIndex;
                  const isSelected = flatIndex === selectedIndex;
                  const Icon = command.icon;
                  const isComponent = command.type === 'component';
                  const hasLogo = isComponent && 'iconUrl' in command && command.iconUrl;

                  return (
                    <button
                      key={command.id}
                      data-selected={isSelected}
                      onClick={() => executeCommand(command)}
                      onMouseEnter={() => setSelectedIndex(flatIndex)}
                      className={cn(
                        'w-full flex items-center gap-3 px-3 py-2.5 pl-3 border-l-2 text-left transition-colors duration-75',
                        isSelected
                          ? 'bg-primary/10 border-primary text-foreground'
                          : 'hover:bg-accent/50 border-transparent text-muted-foreground',
                        isComponent && !canPlaceComponents && 'opacity-50',
                      )}
                      disabled={isComponent && !canPlaceComponents}
                    >
                      {/* Icon or Logo */}
                      <div className="w-5 h-5 flex-shrink-0 flex items-center justify-center">
                        {hasLogo ? (
                          <img
                            src={(command as ComponentCommand & { iconUrl: string }).iconUrl}
                            alt=""
                            width={20}
                            height={20}
                            className="w-5 h-5 object-contain"
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                            }}
                          />
                        ) : command.iconName ? (
                          <DynamicIcon
                            name={command.iconName}
                            fallback="box"
                            className={cn(
                              'w-4 h-4',
                              isSelected ? 'text-primary' : 'text-muted-foreground',
                            )}
                          />
                        ) : Icon ? (
                          <Icon
                            className={cn(
                              'w-4 h-4',
                              isSelected ? 'text-primary' : 'text-muted-foreground',
                            )}
                          />
                        ) : null}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{command.label}</div>
                        {command.description && (
                          <div
                            className={cn(
                              'text-xs truncate',
                              isSelected ? 'text-muted-foreground' : 'text-muted-foreground',
                            )}
                          >
                            {command.description}
                          </div>
                        )}
                      </div>
                      {isSelected && <ArrowRight className="w-4 h-4 flex-shrink-0 text-primary" />}
                    </button>
                  );
                })}
                {group.hasMore && (
                  <button
                    onClick={() => {
                      const categoryRoutes: Partial<Record<CommandCategory, string>> = {
                        templates: '/templates',
                        schedules: '/schedules',
                        secrets: '/secrets',
                        'api-keys': '/api-keys',
                        webhooks: '/webhooks',
                        workflows: '/',
                      };
                      const route = categoryRoutes[group.category];
                      if (route) {
                        navigate(route);
                        close();
                      }
                    }}
                    className="w-full px-4 py-1.5 text-left text-xs text-primary hover:underline"
                  >
                    View all {group.totalCount} results
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer with keyboard hints */}
        <div className="flex items-center justify-between gap-4 px-4 py-2.5 border-t border-border/50 bg-muted/30 text-xs text-muted-foreground">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <kbd className="inline-flex h-5 items-center rounded border border-border/50 bg-background px-1 font-mono text-[10px]">
                ↑
              </kbd>
              <kbd className="inline-flex h-5 items-center rounded border border-border/50 bg-background px-1 font-mono text-[10px]">
                ↓
              </kbd>
              <span>Navigate</span>
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="inline-flex h-5 items-center rounded border border-border/50 bg-background px-1.5 font-mono text-[10px]">
                <CornerDownLeft className="w-3 h-3" />
              </kbd>
              <span>Select</span>
            </span>
          </div>
          <span className="flex items-center gap-1.5">
            <kbd className="inline-flex h-5 items-center rounded border border-border/50 bg-background px-1.5 font-mono text-[10px]">
              ESC
            </kbd>
            <span>Close</span>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
