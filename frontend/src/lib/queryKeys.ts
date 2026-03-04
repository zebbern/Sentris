import { useAuthStore } from '@/store/authStore';

const getOrgScope = () => useAuthStore.getState().organizationId || '__no-org__';
const getUserScope = () => useAuthStore.getState().userId || '__no-user__';

export const queryKeys = {
  secrets: {
    all: () => ['secrets', getOrgScope()] as const,
    detail: (id: string) => ['secrets', getOrgScope(), id] as const,
  },
  components: {
    all: () => ['components', getOrgScope()] as const,
  },
  runs: {
    root: () => ['runs', getOrgScope()] as const,
    byWorkflow: (workflowId: string) => ['runs', getOrgScope(), workflowId] as const,
    global: () => ['runs', getOrgScope(), '__global__'] as const,
    detail: (runId: string) => ['runs', getOrgScope(), 'detail', runId] as const,
  },
  schedules: {
    root: () => ['schedules', getOrgScope()] as const,
    all: (filters?: Record<string, unknown>) => ['schedules', getOrgScope(), filters] as const,
  },
  mcpServers: {
    all: () => ['mcpServers', getOrgScope()] as const,
    tools: () => ['mcpServers', getOrgScope(), 'tools'] as const,
  },
  mcpGroups: {
    all: () => ['mcpGroups', getOrgScope()] as const,
    serversRoot: () => ['mcpGroupServers', getOrgScope()] as const,
    servers: (groupId: string) => ['mcpGroupServers', getOrgScope(), groupId] as const,
    templates: () => ['mcpGroupTemplates', getOrgScope()] as const,
    withServers: () => [...queryKeys.mcpGroups.all(), 'withServers'] as const,
  },
  integrations: {
    providers: () => ['integrationProviders', getOrgScope()] as const,
    connectionsRoot: () => ['integrationConnections', getOrgScope()] as const,
    connections: (userId?: string) =>
      ['integrationConnections', getOrgScope(), userId || getUserScope()] as const,
    providerConfig: (providerId: string) => ['providerConfig', getOrgScope(), providerId] as const,
  },
  apiKeys: {
    all: () => ['apiKeys', getOrgScope()] as const,
  },
  auditLogs: {
    all: (filters?: Record<string, unknown>) => ['auditLogs', getOrgScope(), filters] as const,
  },
  webhooks: {
    all: (filters?: Record<string, unknown>) => ['webhooks', getOrgScope(), filters] as const,
    detail: (id: string) => ['webhooks', getOrgScope(), id] as const,
    deliveries: (webhookId: string) => ['webhookDeliveries', getOrgScope(), webhookId] as const,
  },
  artifacts: {
    root: () => ['artifactLibrary', getOrgScope()] as const,
    library: (filters?: Record<string, unknown>) =>
      ['artifactLibrary', getOrgScope(), filters] as const,
    byRun: (runId: string) => ['runArtifacts', getOrgScope(), runId] as const,
  },
  humanInputs: {
    root: () => ['humanInputs', getOrgScope()] as const,
    all: (filters?: Record<string, unknown>) => ['humanInputs', getOrgScope(), filters] as const,
  },
  executions: {
    nodeIO: (runId: string) => ['executionNodeIO', getOrgScope(), runId] as const,
    result: (runId: string) => ['executionResult', getOrgScope(), runId] as const,
    run: (runId: string) => ['executionRun', getOrgScope(), runId] as const,
    status: (runId: string) => ['executionStatus', getOrgScope(), runId] as const,
    trace: (runId: string) => ['executionTrace', getOrgScope(), runId] as const,
    events: (runId: string) => ['executionEvents', getOrgScope(), runId] as const,
    dataFlows: (runId: string) => ['executionDataFlows', getOrgScope(), runId] as const,
    terminalChunks: (runId: string, nodeRef: string, stream: string) =>
      ['executionTerminal', getOrgScope(), runId, nodeRef, stream] as const,
  },
  templates: {
    all: (filters?: Record<string, unknown>) => ['templates', getOrgScope(), filters] as const,
    categories: () => ['templateCategories', getOrgScope()] as const,
    tags: () => ['templateTags', getOrgScope()] as const,
  },
  workflows: {
    list: () => ['workflows', getOrgScope()] as const,
    summary: (filters?: Record<string, unknown>) => {
      if (filters) return ['workflowsSummary', getOrgScope(), filters] as const;
      return ['workflowsSummary', getOrgScope()] as const;
    },
    detail: (id: string) => ['workflow', getOrgScope(), id] as const,
    runtimeInputs: (workflowId: string) =>
      ['workflowRuntimeInputs', getOrgScope(), workflowId] as const,
    versions: (workflowId: string) => ['workflowVersions', getOrgScope(), workflowId] as const,
  },
  workflowTags: {
    all: () => ['workflowTags', getOrgScope()] as const,
  },
  analyticsSettings: {
    all: () => ['analyticsSettings', getOrgScope()] as const,
  },
  findings: {
    all: (filters?: Record<string, unknown>) => ['findings', getOrgScope(), filters] as const,
    detail: (id: string) => ['findings', getOrgScope(), 'detail', id] as const,
    stats: (filters?: Record<string, unknown>) =>
      ['findings', getOrgScope(), 'stats', filters] as const,
    history: (findingId: string) => ['findings', getOrgScope(), 'history', findingId] as const,
  },
  orgMembers: {
    all: () => ['orgMembers', getOrgScope()] as const,
  },
  dashboard: {
    stats: () => ['dashboard', getOrgScope(), 'stats'] as const,
    recentActivity: () => ['dashboard', getOrgScope(), 'recent-activity'] as const,
  },
  // Registry catalog is global (not org-scoped) — shared across all organizations
  notificationChannels: {
    all: () => ['notificationChannels', getOrgScope()] as const,
    detail: (id: string) => ['notificationChannels', getOrgScope(), id] as const,
    deliveries: (channelId: string) =>
      ['notificationChannels', getOrgScope(), 'deliveries', channelId] as const,
  },
  ticketing: {
    connection: () => ['ticketing', getOrgScope(), 'connection'] as const,
    projects: () => ['ticketing', getOrgScope(), 'projects'] as const,
    issueTypes: (projectKey: string) =>
      ['ticketing', getOrgScope(), 'issueTypes', projectKey] as const,
    findingTicket: (findingId: string) =>
      ['ticketing', getOrgScope(), 'ticket', findingId] as const,
  },
  mcpRegistry: {
    catalog: (filters?: Record<string, unknown>) =>
      filters
        ? (['mcpRegistry', 'catalog', filters] as const)
        : (['mcpRegistry', 'catalog'] as const),
    detail: (name: string) => ['mcpRegistry', 'detail', name] as const,
    syncStatus: () => ['mcpRegistry', 'syncStatus'] as const,
    categories: () => ['mcpRegistry', 'categories'] as const,
  },
} as const;
