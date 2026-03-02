import { describe, it, expect, mock, afterEach } from 'bun:test';
import { renderHook, cleanup } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mutable mock state
// ---------------------------------------------------------------------------

let mockWorkflows: any[] = [];
let mockComponents: Record<string, any> = {};
let mockTemplates: any[] = [];
let mockSchedules: any[] = [];
let mockSecrets: any[] = [];
let mockApiKeys: any[] = [];
let mockWebhooks: any[] = [];

// ---------------------------------------------------------------------------
// Module mocks (BEFORE import)
// ---------------------------------------------------------------------------

mock.module('@/hooks/queries/useComponentQueries', () => ({
  useComponents: () => ({
    data: { byId: mockComponents },
    isLoading: false,
  }),
}));

mock.module('@/hooks/queries/useWorkflowQueries', () => ({
  useWorkflowsList: () => ({
    data: mockWorkflows,
    isLoading: false,
  }),
}));

mock.module('@/hooks/queries/useTemplateQueries', () => ({
  useTemplates: () => ({
    data: mockTemplates,
  }),
}));

mock.module('@/hooks/queries/useScheduleQueries', () => ({
  useSchedules: () => ({
    data: mockSchedules,
  }),
}));

mock.module('@/hooks/queries/useSecretQueries', () => ({
  useSecrets: () => ({
    data: mockSecrets,
  }),
}));

mock.module('@/hooks/queries/useApiKeyQueries', () => ({
  useApiKeys: () => ({
    data: mockApiKeys,
  }),
}));

mock.module('@/hooks/queries/useWebhookQueries', () => ({
  useWebhooks: () => ({
    data: mockWebhooks,
  }),
}));

mock.module('@/config/env', () => ({
  env: {
    VITE_ENABLE_IT_OPS: false,
    VITE_ENABLE_CONNECTIONS: false,
  },
}));

mock.module('@/schemas/workflow', () => ({
  WorkflowMetadataSchema: {
    parse: (w: any) => w,
  },
}));

import { useEntityCommands } from '../useEntityCommands';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  mockWorkflows = [];
  mockComponents = {};
  mockTemplates = [];
  mockSchedules = [];
  mockSecrets = [];
  mockApiKeys = [];
  mockWebhooks = [];
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useEntityCommands', () => {
  it('returns empty arrays when no data', () => {
    const { result } = renderHook(() => useEntityCommands(true));

    expect(result.current.workflowCommands).toHaveLength(0);
    expect(result.current.componentCommands).toHaveLength(0);
    expect(result.current.templateCommands).toHaveLength(0);
    expect(result.current.scheduleCommands).toHaveLength(0);
    expect(result.current.secretCommands).toHaveLength(0);
    expect(result.current.apiKeyCommands).toHaveLength(0);
    expect(result.current.webhookCommands).toHaveLength(0);
  });

  it('maps workflows to WorkflowCommand type', () => {
    mockWorkflows = [{ id: 'wf-1', name: 'My Workflow', nodes: [{ id: 'n1' }, { id: 'n2' }] }];

    const { result } = renderHook(() => useEntityCommands(true));

    expect(result.current.workflowCommands).toHaveLength(1);
    const cmd = result.current.workflowCommands[0];
    expect(cmd.type).toBe('workflow');
    expect(cmd.id).toBe('workflow-wf-1');
    expect(cmd.label).toBe('My Workflow');
    expect(cmd.category).toBe('workflows');
    if (cmd.type === 'workflow') {
      expect(cmd.workflowId).toBe('wf-1');
    }
  });

  it('maps components to ComponentCommand type', () => {
    mockComponents = {
      'http-req': {
        id: 'http-req',
        name: 'HTTP Request',
        slug: 'http-request',
        description: 'Make HTTP calls',
        category: 'networking',
        icon: null,
        logo: null,
      },
    };

    const { result } = renderHook(() => useEntityCommands(true));

    expect(result.current.componentCommands).toHaveLength(1);
    const cmd = result.current.componentCommands[0];
    expect(cmd.type).toBe('component');
    expect(cmd.id).toBe('component-http-req');
    expect(cmd.label).toBe('HTTP Request');
    expect(cmd.category).toBe('components');
    if (cmd.type === 'component') {
      expect(cmd.componentId).toBe('http-req');
      expect(cmd.componentName).toBe('HTTP Request');
    }
  });

  it('filters out entry-point components', () => {
    mockComponents = {
      'core.workflow.entrypoint': {
        id: 'core.workflow.entrypoint',
        name: 'Entry Point',
        slug: 'entry-point',
        description: '',
        category: 'core',
        icon: null,
        logo: null,
      },
    };

    const { result } = renderHook(() => useEntityCommands(true));
    expect(result.current.componentCommands).toHaveLength(0);
  });

  it('filters out demo components', () => {
    mockComponents = {
      'demo-comp': {
        id: 'demo-comp',
        name: 'Demo Widget',
        slug: 'demo-widget',
        description: '',
        category: 'demo',
        icon: null,
        logo: null,
      },
    };

    const { result } = renderHook(() => useEntityCommands(true));
    expect(result.current.componentCommands).toHaveLength(0);
  });

  it('maps templates to navigation commands', () => {
    mockTemplates = [
      {
        id: 't1',
        name: 'Alert Template',
        description: 'Send alerts',
        category: 'Security',
        tags: ['alert'],
      },
    ];

    const { result } = renderHook(() => useEntityCommands(true));
    expect(result.current.templateCommands).toHaveLength(1);
    const cmd = result.current.templateCommands[0];
    expect(cmd.type).toBe('navigation');
    expect(cmd.label).toBe('Alert Template');
    expect(cmd.category).toBe('templates');
  });

  it('maps schedules to navigation commands', () => {
    mockSchedules = [
      { id: 's1', name: 'Daily Scan', cronExpression: '0 0 * * *', status: 'active' },
    ];

    const { result } = renderHook(() => useEntityCommands(true));
    expect(result.current.scheduleCommands).toHaveLength(1);
    const cmd = result.current.scheduleCommands[0];
    expect(cmd.type).toBe('navigation');
    expect(cmd.category).toBe('schedules');
  });

  it('maps secrets to navigation commands', () => {
    mockSecrets = [{ id: 'sec1', name: 'API_TOKEN', description: 'Token' }];

    const { result } = renderHook(() => useEntityCommands(true));
    expect(result.current.secretCommands).toHaveLength(1);
    expect(result.current.secretCommands[0].category).toBe('secrets');
  });

  it('maps API keys to navigation commands', () => {
    mockApiKeys = [{ id: 'ak1', name: 'Production Key', description: '', keyHint: 'sk_...abc' }];

    const { result } = renderHook(() => useEntityCommands(true));
    expect(result.current.apiKeyCommands).toHaveLength(1);
    expect(result.current.apiKeyCommands[0].category).toBe('api-keys');
  });

  it('maps webhooks to navigation commands', () => {
    mockWebhooks = [{ id: 'wh1', name: 'GitHub Hook', status: 'active' }];

    const { result } = renderHook(() => useEntityCommands(true));
    expect(result.current.webhookCommands).toHaveLength(1);
    expect(result.current.webhookCommands[0].category).toBe('webhooks');
  });
});
