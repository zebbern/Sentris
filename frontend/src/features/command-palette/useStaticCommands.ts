import { useMemo } from 'react';
import {
  Plus,
  Sun,
  Moon,
  Workflow,
  CalendarClock,
  KeyRound,
  Shield,
  Archive,
  Plug,
  Webhook,
  Zap,
  ServerCog,
  Sparkles,
} from 'lucide-react';
import { env } from '@/config/env';
import type { Command } from './command-palette-types';

interface UseStaticCommandsOptions {
  navigate: (path: string) => void;
  close: () => void;
  theme: string;
  startTransition: () => void;
}

export function useStaticCommands({
  navigate,
  close,
  theme,
  startTransition,
}: UseStaticCommandsOptions): Command[] {
  return useMemo<Command[]>(() => {
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
      {
        id: 'nav-agent-skills',
        type: 'navigation',
        label: 'Agent Skills',
        description: 'Manage reusable agent SKILL.md playbooks',
        category: 'navigation',
        icon: Sparkles,
        keywords: ['agent', 'skills', 'playbooks', 'claude', 'opencode'],
        href: '/agent-skills',
      },
    ];

    // Add connections navigation if enabled
    if (env.VITE_ENABLE_CONNECTIONS) {
      commands.push({
        id: 'nav-connections',
        type: 'navigation',
        label: 'Connections',
        description: 'Manage third-party connections',
        category: 'navigation',
        icon: Plug,
        keywords: ['connections', 'integrations', 'oauth'],
        href: '/integrations',
      });
    }

    return commands;
  }, [theme, navigate, close, startTransition]);
}
