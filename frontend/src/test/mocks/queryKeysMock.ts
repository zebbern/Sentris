/**
 * Complete queryKeys mock for test files.
 *
 * When a test file uses `mock.module('@/lib/queryKeys', ...)` with only a
 * subset of keys, the mock bleeds into other test files running in the same
 * bun:test process. By providing ALL keys with simple stub implementations,
 * leaked mocks still give downstream consumers the shapes they expect.
 *
 * Usage in test files:
 *   import { createQueryKeysMock } from '@/test/mocks/queryKeysMock';
 *   mock.module('@/lib/queryKeys', () => createQueryKeysMock());
 *
 * Or with overrides:
 *   mock.module('@/lib/queryKeys', () => createQueryKeysMock({
 *     workflows: { versions: (id: string) => ['workflows', id, 'versions'] },
 *   }));
 */

type AnyFn = (...args: any[]) => any;

const stub =
  (...prefix: string[]): AnyFn =>
  (...args: any[]) => [...prefix, ...args];

const DEFAULT_QUERY_KEYS = {
  secrets: {
    all: stub('secrets'),
    detail: stub('secrets', 'detail'),
  },
  components: {
    all: stub('components'),
  },
  runs: {
    root: stub('runs'),
    byWorkflow: stub('runs', 'byWorkflow'),
    global: stub('runs', 'global'),
    detail: stub('runs', 'detail'),
  },
  schedules: {
    root: stub('schedules'),
    all: stub('schedules', 'all'),
  },
  mcpServers: {
    all: stub('mcpServers'),
    tools: stub('mcpServers', 'tools'),
  },
  mcpGroups: {
    all: stub('mcpGroups'),
    serversRoot: stub('mcpGroupServers'),
    servers: stub('mcpGroupServers', 'servers'),
    templates: stub('mcpGroupTemplates'),
  },
  integrations: {
    providers: stub('integrationProviders'),
    connectionsRoot: stub('integrationConnections'),
    connections: stub('integrationConnections', 'connections'),
    providerConfig: stub('providerConfig'),
  },
  apiKeys: {
    all: stub('apiKeys'),
  },
  auditLogs: {
    all: stub('auditLogs'),
  },
  webhooks: {
    all: stub('webhooks'),
    detail: stub('webhooks', 'detail'),
    deliveries: stub('webhookDeliveries'),
  },
  artifacts: {
    root: stub('artifactLibrary'),
    library: stub('artifactLibrary', 'library'),
    byRun: stub('runArtifacts'),
  },
  humanInputs: {
    root: stub('humanInputs'),
    all: stub('humanInputs', 'all'),
  },
  executions: {
    nodeIO: stub('executionNodeIO'),
    result: stub('executionResult'),
    run: stub('executionRun'),
    status: stub('executionStatus'),
    trace: stub('executionTrace'),
    events: stub('executionEvents'),
    dataFlows: stub('executionDataFlows'),
    terminalChunks: stub('executionTerminal'),
  },
  templates: {
    all: stub('templates'),
    categories: stub('templateCategories'),
    tags: stub('templateTags'),
  },
  workflows: {
    list: stub('workflows'),
    summary: stub('workflowsSummary'),
    detail: stub('workflow', 'detail'),
    runtimeInputs: stub('workflowRuntimeInputs'),
    versions: stub('workflowVersions'),
  },
  workflowTags: {
    all: stub('workflowTags'),
  },
  analyticsSettings: {
    all: stub('analyticsSettings'),
  },
  findings: {
    all: stub('findings'),
    detail: stub('findings', 'detail'),
    stats: stub('findings', 'stats'),
  },
  dashboard: {
    stats: stub('dashboard', 'stats'),
    recentActivity: stub('dashboard', 'recent-activity'),
  },
};

/**
 * Create a complete queryKeys mock object.
 *
 * @param overrides — deep-merge custom key factories for the keys
 *   your test actually uses (e.g. `{ workflows: { versions: ... } }`).
 */
export function createQueryKeysMock(overrides?: Record<string, Record<string, AnyFn>>): {
  queryKeys: typeof DEFAULT_QUERY_KEYS;
} {
  if (!overrides) return { queryKeys: DEFAULT_QUERY_KEYS };

  const merged = { ...DEFAULT_QUERY_KEYS };
  for (const [group, fns] of Object.entries(overrides)) {
    (merged as any)[group] = {
      ...(merged as any)[group],
      ...fns,
    };
  }

  return { queryKeys: merged };
}
