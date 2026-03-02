import { afterAll, describe, it, expect, mock } from 'bun:test';
import { createAuthStoreMock, DEFAULT_AUTH_ORG_ID } from '@/test/mocks/auth-store';
import { realModuleExports } from '@/test/restore-mocks';

// Restore real queryKeys module — bled createQueryKeysMock from other test
// files replaces queryKeys with a simplified stub that lacks org scope.
mock.module('@/lib/queryKeys', () => realModuleExports('@/lib/queryKeys'));

// The real queryKeys module captured the real useAuthStore at import time.
// mock.module('@/store/authStore') only affects future imports; the real
// queryKeys still reads from the original store. Set state directly on the
// real store so getOrgScope()/getUserScope() return the expected values.
const realAuthModule = realModuleExports('@/store/authStore') as any;
realAuthModule.useAuthStore.setState({
  organizationId: DEFAULT_AUTH_ORG_ID,
  userId: 'user-1',
});

// Also register the authStore mock for any downstream imports.
mock.module('@/store/authStore', () =>
  createAuthStoreMock({ organizationId: DEFAULT_AUTH_ORG_ID, userId: 'user-1' }),
);

afterAll(() => {
  // Reset the real auth store state to avoid polluting other test files.
  realAuthModule.useAuthStore.setState({
    organizationId: undefined,
    userId: undefined,
  });
});

// Import after mocking
import { queryKeys } from '../queryKeys';

const TEST_ORG = DEFAULT_AUTH_ORG_ID;
const TEST_USER = 'user-1';

describe('queryKeys', () => {
  // --- Structure ---

  it('has all expected domain key factories', () => {
    const domains = Object.keys(queryKeys);
    expect(domains).toContain('secrets');
    expect(domains).toContain('components');
    expect(domains).toContain('runs');
    expect(domains).toContain('schedules');
    expect(domains).toContain('mcpServers');
    expect(domains).toContain('mcpGroups');
    expect(domains).toContain('integrations');
    expect(domains).toContain('apiKeys');
    expect(domains).toContain('auditLogs');
    expect(domains).toContain('webhooks');
    expect(domains).toContain('artifacts');
    expect(domains).toContain('humanInputs');
    expect(domains).toContain('executions');
    expect(domains).toContain('templates');
    expect(domains).toContain('workflows');
    expect(domains).toContain('workflowTags');
    expect(domains).toContain('analyticsSettings');
    expect(domains).toContain('dashboard');
  });

  // --- Org scope ---

  it('includes org scope in keys', () => {
    const key = queryKeys.secrets.all();
    expect(key).toContain(TEST_ORG);
  });

  // --- Stability ---

  it('each key factory returns a stable array for same input', () => {
    const key1 = queryKeys.secrets.all();
    const key2 = queryKeys.secrets.all();
    expect(key1).toEqual(key2);
  });

  // --- Uniqueness ---

  it('different domains produce non-colliding keys', () => {
    const secretsAll = queryKeys.secrets.all();
    const componentsAll = queryKeys.components.all();
    expect(secretsAll[0]).not.toBe(componentsAll[0]);
  });

  // --- Secrets ---

  it('secrets.all returns [secrets, org]', () => {
    const key = queryKeys.secrets.all();
    expect(key[0]).toBe('secrets');
    expect(key[1]).toBe(TEST_ORG);
  });

  it('secrets.detail includes the id parameter', () => {
    const key = queryKeys.secrets.detail('sec-123');
    expect(key).toEqual(['secrets', TEST_ORG, 'sec-123']);
  });

  // --- Runs ---

  it('runs.root returns [runs, org]', () => {
    const key = queryKeys.runs.root();
    expect(key[0]).toBe('runs');
    expect(key[1]).toBe(TEST_ORG);
  });

  it('runs.byWorkflow includes workflowId', () => {
    const key = queryKeys.runs.byWorkflow('wf-1');
    expect(key).toEqual(['runs', TEST_ORG, 'wf-1']);
  });

  it('runs.global includes __global__ marker', () => {
    const key = queryKeys.runs.global();
    expect(key).toContain('__global__');
  });

  it('runs.detail includes detail and runId', () => {
    const key = queryKeys.runs.detail('run-1');
    expect(key).toEqual(['runs', TEST_ORG, 'detail', 'run-1']);
  });

  // --- Executions ---

  it('executions.status includes runId', () => {
    const key = queryKeys.executions.status('run-1');
    expect(key[0]).toBe('executionStatus');
    expect(key).toContain('run-1');
  });

  it('executions.trace includes runId', () => {
    const key = queryKeys.executions.trace('run-1');
    expect(key[0]).toBe('executionTrace');
    expect(key).toContain('run-1');
  });

  it('executions.events includes runId', () => {
    const key = queryKeys.executions.events('run-1');
    expect(key[0]).toBe('executionEvents');
    expect(key).toContain('run-1');
  });

  it('executions.dataFlows includes runId', () => {
    const key = queryKeys.executions.dataFlows('run-1');
    expect(key[0]).toBe('executionDataFlows');
    expect(key).toContain('run-1');
  });

  it('executions.terminalChunks includes runId, nodeRef, and stream', () => {
    const key = queryKeys.executions.terminalChunks('run-1', 'node-1', 'pty');
    expect(key).toEqual(['executionTerminal', TEST_ORG, 'run-1', 'node-1', 'pty']);
  });

  it('executions.nodeIO includes runId', () => {
    const key = queryKeys.executions.nodeIO('run-1');
    expect(key[0]).toBe('executionNodeIO');
    expect(key).toContain('run-1');
  });

  it('executions.result includes runId', () => {
    const key = queryKeys.executions.result('run-1');
    expect(key[0]).toBe('executionResult');
    expect(key).toContain('run-1');
  });

  it('executions.run includes runId', () => {
    const key = queryKeys.executions.run('run-1');
    expect(key[0]).toBe('executionRun');
    expect(key).toContain('run-1');
  });

  // --- Webhooks ---

  it('webhooks.detail includes webhook id', () => {
    const key = queryKeys.webhooks.detail('wh-1');
    expect(key).toEqual(['webhooks', TEST_ORG, 'wh-1']);
  });

  it('webhooks.deliveries includes webhookId', () => {
    const key = queryKeys.webhooks.deliveries('wh-1');
    expect(key[0]).toBe('webhookDeliveries');
    expect(key).toContain('wh-1');
  });

  // --- Workflows ---

  it('workflows.list returns [workflows, org]', () => {
    const key = queryKeys.workflows.list();
    expect(key).toEqual(['workflows', TEST_ORG]);
  });

  it('workflows.detail includes workflow id', () => {
    const key = queryKeys.workflows.detail('wf-1');
    expect(key).toEqual(['workflow', TEST_ORG, 'wf-1']);
  });

  it('workflows.summary without filters returns [workflowsSummary, org]', () => {
    const key = queryKeys.workflows.summary();
    expect(key).toEqual(['workflowsSummary', TEST_ORG]);
  });

  it('workflows.summary with filters includes them', () => {
    const key = queryKeys.workflows.summary({ status: 'active' });
    expect(key).toEqual(['workflowsSummary', TEST_ORG, { status: 'active' }]);
  });

  it('workflows.versions includes workflowId', () => {
    const key = queryKeys.workflows.versions('wf-1');
    expect(key).toEqual(['workflowVersions', TEST_ORG, 'wf-1']);
  });

  // --- Integrations ---

  it('integrations.connections includes userId or default scope', () => {
    const key = queryKeys.integrations.connections();
    expect(key[0]).toBe('integrationConnections');
    expect(key).toContain(TEST_USER);
  });

  it('integrations.connections with explicit userId uses that', () => {
    const key = queryKeys.integrations.connections('other-user');
    expect(key).toContain('other-user');
  });

  // --- Templates ---

  it('templates.all without filters returns [templates, org, undefined]', () => {
    const key = queryKeys.templates.all();
    expect(key[0]).toBe('templates');
    expect(key[1]).toBe(TEST_ORG);
  });

  it('templates.categories returns array', () => {
    const key = queryKeys.templates.categories();
    expect(key[0]).toBe('templateCategories');
  });

  // --- Dashboard ---

  it('dashboard.stats returns unique key', () => {
    const key = queryKeys.dashboard.stats();
    expect(key[0]).toBe('dashboard');
    expect(key).toContain('stats');
  });

  it('dashboard.recentActivity returns unique key', () => {
    const key = queryKeys.dashboard.recentActivity();
    expect(key[0]).toBe('dashboard');
    expect(key).toContain('recent-activity');
  });
});
