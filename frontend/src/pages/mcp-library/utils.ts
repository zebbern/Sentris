import { Cloud, GitBranch, Globe, Package } from 'lucide-react';
import { env } from '@/config/env';
import type {
  AgentReadiness,
  ServerFormData,
  ToolCounts,
  TransportType,
  HeaderEntry,
} from './types';
import type { McpHealthStatus } from '@sentris/shared';

export function getMcpAgentReadiness(input: {
  enabled: boolean;
  healthStatus?: McpHealthStatus | null;
  toolCounts?: ToolCounts | null;
}): AgentReadiness {
  if (!input.enabled) {
    return { status: 'disabled', label: 'Disabled', tone: 'muted' };
  }

  if (input.healthStatus === 'unhealthy') {
    return { status: 'unhealthy', label: 'Unhealthy', tone: 'destructive' };
  }

  if (input.healthStatus !== 'healthy') {
    return { status: 'needs-test', label: 'Needs test', tone: 'warning' };
  }

  if (!input.toolCounts || input.toolCounts.enabled <= 0) {
    return { status: 'no-tools', label: 'No tools', tone: 'warning' };
  }

  return { status: 'ready', label: 'Ready', tone: 'success' };
}

/**
 * Maps a group slug/name to an appropriate icon component.
 */
export function getGroupIcon(groupSlug: string, groupName: string) {
  const slug = groupSlug.toLowerCase();
  const name = groupName.toLowerCase();

  if (slug === 'aws' || name.includes('aws') || name.includes('amazon')) return Cloud;
  if (slug.includes('github') || name.includes('github') || name.includes('git')) return GitBranch;
  if (slug.includes('gcp') || name.includes('gcp') || name.includes('google')) return Globe;
  return Package;
}

/**
 * Returns a logo.dev URL for known group slugs, or null if unavailable.
 */
export function getGroupLogoUrl(groupSlug: string) {
  const domainMap: Record<string, string> = {
    aws: 'aws.amazon.com',
  };

  const domain = domainMap[groupSlug.toLowerCase()];
  if (!domain || !env.VITE_LOGO_DEV_PUBLIC_KEY) return null;

  return `https://img.logo.dev/${domain}?token=${env.VITE_LOGO_DEV_PUBLIC_KEY}`;
}

/**
 * Returns Tailwind class sets for theming a group card.
 */
export function getGroupTheme(groupSlug: string) {
  if (groupSlug === 'aws') {
    return {
      container: 'bg-aws-accent/5 dark:bg-aws-accent/10 border-aws-accent/20',
      headerBorder: 'border-aws-accent/20',
      iconWrapper: 'bg-aws-accent/5 dark:bg-aws-accent/10 border-aws-accent/20',
      iconText: 'text-aws-accent-foreground',
      pillBorder: 'border-aws-accent/20',
      accentText: 'text-aws-accent-foreground',
    };
  }

  return {
    container: 'bg-background border-border',
    headerBorder: 'border-border',
    iconWrapper: 'bg-muted border-border',
    iconText: 'text-muted-foreground',
    pillBorder: 'border-border',
    accentText: 'text-muted-foreground',
  };
}

/**
 * Parses a Claude Code style JSON config into server form data entries.
 */
export function parseClaudeCodeConfig(jsonString: string): {
  servers: { name: string; config: ServerFormData }[];
  error?: string;
} {
  try {
    const parsed = JSON.parse(jsonString);

    let mcpServers: Record<string, unknown>;

    if (parsed.mcpServers && typeof parsed.mcpServers === 'object') {
      mcpServers = parsed.mcpServers;
    } else if (parsed.url || parsed.command) {
      mcpServers = { 'Imported Server': parsed };
    } else {
      return {
        servers: [],
        error: 'Invalid config: expected mcpServers object or server config with url/command',
      };
    }

    const servers: { name: string; config: ServerFormData }[] = [];

    for (const [name, config] of Object.entries(mcpServers)) {
      const serverConfig = config as {
        url?: string;
        headers?: Record<string, string>;
        command?: string;
        args?: string[];
      };

      let transportType: TransportType = 'http';
      if (serverConfig.command) {
        transportType = 'stdio';
      }

      servers.push({
        name,
        config: {
          name,
          description: '',
          transportType,
          endpoint: serverConfig.url ?? '',
          command: serverConfig.command ?? '',
          args: serverConfig.args?.join('\n') ?? '',
          headers: serverConfig.headers ? JSON.stringify(serverConfig.headers, null, 2) : '',
          healthCheckUrl: '',
          enabled: true,
        },
      });
    }

    return { servers };
  } catch (e: unknown) {
    return {
      servers: [],
      error: e instanceof Error ? `JSON parse error: ${e.message}` : 'Invalid JSON',
    };
  }
}

/**
 * Generates a Claude Code style JSON string from form data (for JSON tab display).
 */
export function formDataToJson(
  data: ServerFormData,
  headerEntries: HeaderEntry[],
  serverHeaderKeys?: string[] | null,
): string {
  const serverConfig: Record<string, unknown> = {};

  if (data.transportType === 'stdio') {
    serverConfig.command = data.command;
    if (data.args.trim()) {
      serverConfig.args = data.args
        .split('\n')
        .map((a) => a.trim())
        .filter(Boolean);
    }
  } else {
    serverConfig.url = data.endpoint;
  }

  const headersToShow: Record<string, string> = {};

  if (serverHeaderKeys && serverHeaderKeys.length > 0) {
    for (const key of serverHeaderKeys) {
      headersToShow[key] = '****';
    }
  }

  for (const entry of headerEntries) {
    if (entry.key.trim()) {
      if (entry.value.trim()) {
        headersToShow[entry.key] = '****';
      } else if (entry.secretId) {
        headersToShow[entry.key] = '****';
      }
    }
  }

  if (Object.keys(headersToShow).length > 0) {
    serverConfig.headers = headersToShow;
  }

  return JSON.stringify(
    {
      mcpServers: {
        [data.name || 'server']: serverConfig,
      },
    },
    null,
    2,
  );
}

/**
 * Builds a headers payload object from header entries for API requests.
 */
export function buildHeadersPayload(
  headerEntries: HeaderEntry[],
): Record<string, string> | undefined {
  const headersPayload = headerEntries
    .filter((e) => e.key.trim() && (e.value.trim() || e.secretId))
    .reduce(
      (acc, entry) => {
        const key = entry.key.trim();
        const value = entry.secretId ? `{{secret:${entry.secretId}}}` : entry.value.trim();
        acc[key] = value;
        return acc;
      },
      {} as Record<string, string>,
    );

  return Object.keys(headersPayload).length > 0 ? headersPayload : undefined;
}
