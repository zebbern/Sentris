import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'bun:test';
import { z } from 'zod';
import {
  componentRegistry,
  inputs,
  outputs,
  parameters,
  param,
  port,
} from '@sentris/component-sdk';
import type {
  ClaimComponentDispatchOutcome,
  InvocationManifest,
  McpCapabilityCatalogSnapshot,
  PreparedInvocationRef,
  PrepareToolInvocationOutcome,
  ToolInvocationRequest,
  ToolInvocationResult,
} from '@sentris/shared';

import { computeMcpBindingFingerprint } from '../mcp-binding-fingerprint';
import { McpInvocationService } from '../mcp-invocation.service';

const GRANT_ID = '11111111-1111-4111-8111-111111111111';
const SNAPSHOT_ID = '22222222-2222-4222-8222-222222222222';
const INVOCATION_ID = '33333333-3333-4333-8333-333333333333';
const ATTEMPT_ID = '44444444-4444-4444-8444-444444444444';
const WORKFLOW_ID = '55555555-5555-4555-8555-555555555555';
const VERSION_ID = '66666666-6666-4666-8666-666666666666';
const SCOPE_ID = '77777777-7777-4777-8777-777777777777';
const COMPONENT_ID = 'test.mcp-invocation-boundary';
const NODE_ID = 'scanner-node';
const TOOL_NAME = 'scan_target';

if (!componentRegistry.has(COMPONENT_ID)) {
  componentRegistry.register({
    id: COMPONENT_ID,
    label: 'Invocation boundary fixture',
    category: 'security',
    runner: { kind: 'inline' },
    inputs: inputs({
      target: port(z.string(), { label: 'Target' }),
      mode: port(z.enum(['fast', 'safe']), { label: 'Action mode' }),
      credential: port(z.string(), { label: 'Credential', editor: 'secret' }),
    }),
    outputs: outputs({}),
    parameters: parameters({
      mode: param(z.enum(['fast', 'safe']).default('fast'), {
        label: 'Mode',
        editor: 'select',
        exposeToTool: true,
      }),
      hidden: param(z.string().default('registered'), { label: 'Hidden', editor: 'text' }),
      profile: param(z.string().default('default'), {
        label: 'Profile',
        editor: 'text',
        exposeToTool: true,
      }),
    }),
    docs: 'Test-only invocation boundary component.',
    execute: async () => ({}),
  });
}

const inputSchema = {
  type: 'object',
  properties: {
    target: { type: 'string', minLength: 1 },
    mode: { type: 'string', enum: ['fast', 'safe'] },
    profile: { type: 'string' },
  },
  required: ['target'],
  additionalProperties: false,
};

const registeredTool = {
  nodeId: NODE_ID,
  toolName: TOOL_NAME,
  type: 'component' as const,
  providerKind: 'component',
  status: 'ready' as const,
  exposedToAgent: true,
  componentId: COMPONENT_ID,
  parameters: { mode: 'fast', hidden: 'registered', profile: 'default' },
  inputSchema,
  description: 'Scan a target',
  encryptedCredentials: 'ciphertext',
  registeredAt: '2026-07-31T10:00:00.000Z',
};

const bindingFingerprint = computeMcpBindingFingerprint(registeredTool, [
  { name: TOOL_NAME, description: registeredTool.description, inputSchema },
]);

const snapshot: McpCapabilityCatalogSnapshot = {
  id: SNAPSHOT_ID,
  scope: {
    kind: 'run',
    runId: 'run-1',
    organizationId: 'org-1',
    capabilityGrantId: GRANT_ID,
  },
  version: '1',
  configFingerprint: 'a'.repeat(64),
  tools: [
    {
      canonicalName: TOOL_NAME,
      displayName: 'Scan target',
      description: registeredTool.description,
      inputSchema,
      source: {
        kind: 'component',
        sourceId: NODE_ID,
        nodeId: NODE_ID,
        componentId: COMPONENT_ID,
        bindingFingerprint,
      },
      effects: 'unknown',
      effectsSource: 'sentris-contract',
      retryPolicy: 'pre-dispatch-only',
    },
  ],
  resources: [],
  resourceTemplates: [],
  prompts: [],
  createdAt: '2026-07-31T10:00:00.000Z',
};

const manifest: InvocationManifest = {
  capabilitySnapshotId: SNAPSHOT_ID,
  capabilityGrantId: GRANT_ID,
  version: '1',
  entries: [
    {
      toolName: TOOL_NAME,
      sourceId: NODE_ID,
      destination: 'component-activity',
      retryPolicy: 'pre-dispatch-only',
    },
  ],
};

const grant = {
  id: GRANT_ID,
  organizationId: 'org-1',
  subject: { kind: 'run' as const, runId: 'run-1' },
  sources: [{ sourceId: NODE_ID, toolAccess: { mode: 'all' as const } }],
  createdAt: '2026-07-31T10:00:00.000Z',
};

const request: ToolInvocationRequest = {
  invocationId: INVOCATION_ID,
  scope: {
    kind: 'run',
    runId: 'run-1',
    organizationId: 'org-1',
    capabilityGrantId: GRANT_ID,
  },
  capabilitySnapshotId: SNAPSHOT_ID,
  toolName: TOOL_NAME,
  input: { target: 'example.com', mode: 'safe', profile: 'aggressive' },
  requestedAt: '2099-07-31T10:00:00.000Z',
  deadlineAt: '2099-07-31T10:05:00.000Z',
};

const ref: PreparedInvocationRef = {
  invocationId: INVOCATION_ID,
  attemptId: ATTEMPT_ID,
  attemptNumber: 1,
  capabilitySnapshotId: SNAPSHOT_ID,
  capabilityGrantId: GRANT_ID,
  toolName: TOOL_NAME,
  sourceId: NODE_ID,
  destination: 'component-activity',
  retryPolicy: 'pre-dispatch-only',
  preparedAt: '2026-07-31T10:00:01.000Z',
};

const completedResult: ToolInvocationResult = {
  invocationId: INVOCATION_ID,
  status: 'completed',
  output: { findings: 1 },
  completedAt: '2026-07-31T10:01:00.000Z',
};

function createHarness(
  overrides: {
    authority?: {
      grant: typeof grant;
      snapshot: McpCapabilityCatalogSnapshot;
      manifest: InvocationManifest;
    } | null;
    requestForDispatch?: ToolInvocationRequest;
    claimOutcome?: ClaimComponentDispatchOutcome | { kind: 'claimed' };
  } = {},
) {
  const authority =
    overrides.authority === undefined
      ? {
          grant,
          snapshot,
          manifest,
        }
      : overrides.authority;
  const prepareInvocation = vi.fn(
    async (): Promise<PrepareToolInvocationOutcome> => ({
      kind: 'prepared' as const,
      ref,
      manifest,
    }),
  );
  const reconcileDispatchFailure = vi.fn(async () => ({
    invocationId: INVOCATION_ID,
    status: 'failed' as const,
    error: {
      class: 'deadline-before-dispatch' as const,
      message: 'Invocation deadline expired before dispatch',
      retryable: false,
    },
    completedAt: '2099-07-31T10:05:00.000Z',
  }));
  const repository = {
    getAuthority: vi.fn(async () => authority),
    prepareInvocation,
    getInvocationForDispatch: vi.fn(async () => ({
      request: overrides.requestForDispatch ?? request,
      ref,
      status: 'prepared' as const,
      result: null,
    })),
    claimAttempt: vi.fn(async () => overrides.claimOutcome ?? { kind: 'claimed' as const }),
    settleAttempt: vi.fn(async ({ result }: { result: ToolInvocationResult }) => result),
    markAttemptAmbiguous: vi.fn(
      async ({ message, completedAt }: { message: string; completedAt: string }) => ({
        invocationId: INVOCATION_ID,
        status: 'ambiguous' as const,
        error: {
          class: 'ambiguous-after-dispatch' as const,
          message,
          retryable: false,
        },
        completedAt,
      }),
    ),
    reconcileDispatchFailure,
    reconcileRunInvocations: vi.fn(async () => undefined),
  };
  const resolveComponentForDispatch = vi.fn(async () => ({
    tool: registeredTool,
    credentials: { apiKey: 'resolved-secret' },
  }));
  const toolRegistry = { resolveComponentForDispatch };
  const workflowRuns = {
    findByRunId: vi.fn(async () => ({
      runId: 'run-1',
      workflowId: WORKFLOW_ID,
      workflowVersionId: VERSION_ID,
      organizationId: 'org-1',
      scopeId: SCOPE_ID,
    })),
  };
  const service = new McpInvocationService(
    repository as never,
    toolRegistry as never,
    workflowRuns as never,
  );
  return { service, repository, toolRegistry, workflowRuns };
}

describe('McpInvocationService', () => {
  it('rejects malformed, expired, and non-run requests before persistence', async () => {
    const { service, repository } = createHarness();

    await expect(
      service.prepare({ ...request, deadlineAt: '2000-01-01T00:00:00.000Z' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.prepare({ ...request, input: { target: 42 } } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.prepare({
        ...request,
        scope: {
          kind: 'studio',
          organizationId: 'org-1',
          operationId: '88888888-8888-4888-8888-888888888888',
          capabilityGrantId: GRANT_ID,
          expiresAt: '2099-07-31T10:05:00.000Z',
        },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.prepareInvocation).not.toHaveBeenCalled();
  });

  it.each([
    ['run', { ...request, scope: { ...request.scope, runId: 'other-run' } }],
    ['organization', { ...request, scope: { ...request.scope, organizationId: 'other-org' } }],
    [
      'grant',
      {
        ...request,
        scope: { ...request.scope, capabilityGrantId: '99999999-9999-4999-8999-999999999999' },
      },
    ],
    ['snapshot', { ...request, capabilitySnapshotId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }],
  ])('rejects a %s authority mismatch', async (_name, mismatched) => {
    const { service } = createHarness({ authority: null });
    await expect(service.prepare(mismatched as ToolInvocationRequest)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects unauthorized names and non-component destinations', async () => {
    const unauthorized = createHarness({
      authority: { grant, snapshot, manifest: { ...manifest, entries: [] } },
    });
    await expect(unauthorized.service.prepare(request)).rejects.toBeInstanceOf(ForbiddenException);

    const externalSnapshot: McpCapabilityCatalogSnapshot = {
      ...snapshot,
      tools: [
        {
          ...snapshot.tools[0]!,
          source: {
            kind: 'mcp',
            sourceId: NODE_ID,
            nodeId: NODE_ID,
            upstreamName: 'scan',
            bindingFingerprint,
          },
        },
      ],
    };
    const externalManifest: InvocationManifest = {
      ...manifest,
      entries: [{ ...manifest.entries[0]!, destination: 'mcp-activity' }],
    };
    const external = createHarness({
      authority: { grant, snapshot: externalSnapshot, manifest: externalManifest },
    });
    await expect(external.service.prepare(request)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns the same prepare replay and a stored terminal replay without live resolution', async () => {
    const harness = createHarness();
    const first = await harness.service.prepare(request);
    const second = await harness.service.prepare(request);
    expect(second).toEqual(first);

    harness.repository.prepareInvocation.mockImplementationOnce(async () => ({
      kind: 'terminal' as const,
      result: completedResult,
    }));
    await expect(harness.service.prepare(request)).resolves.toEqual({
      kind: 'terminal',
      result: completedResult,
    });
    expect(harness.toolRegistry.resolveComponentForDispatch).not.toHaveBeenCalled();
  });

  it('claims by immutable run/node binding and returns credentials only in dispatch context', async () => {
    const { service, toolRegistry } = createHarness();
    const outcome = await service.claimComponentDispatch(ref);

    expect(outcome).toEqual({
      kind: 'dispatch',
      context: {
        ref,
        run: {
          runId: 'run-1',
          workflowId: WORKFLOW_ID,
          workflowVersionId: VERSION_ID,
          organizationId: 'org-1',
          scopeId: SCOPE_ID,
        },
        component: {
          nodeId: NODE_ID,
          componentId: COMPONENT_ID,
          arguments: { target: 'example.com', mode: 'safe' },
          parameters: { mode: 'fast', hidden: 'registered', profile: 'aggressive' },
          credentials: { apiKey: 'resolved-secret' },
        },
      },
    });
    expect(toolRegistry.resolveComponentForDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-1',
        nodeId: NODE_ID,
        componentId: COMPONENT_ID,
        toolName: TOOL_NAME,
        bindingFingerprint,
      }),
    );
  });

  it('returns claim terminal/ambiguous replays without exposing a context', async () => {
    const terminal = createHarness({ claimOutcome: { kind: 'terminal', result: completedResult } });
    await expect(terminal.service.claimComponentDispatch(ref)).resolves.toEqual({
      kind: 'terminal',
      result: completedResult,
    });

    const ambiguousResult: ToolInvocationResult = {
      invocationId: INVOCATION_ID,
      status: 'ambiguous',
      error: { class: 'ambiguous-after-dispatch', message: 'Already dispatched', retryable: false },
      completedAt: '2099-07-31T10:01:00.000Z',
    };
    const ambiguous = createHarness({
      claimOutcome: { kind: 'ambiguous', result: ambiguousResult } as never,
    });
    await expect(ambiguous.service.claimComponentDispatch(ref)).resolves.toEqual({
      kind: 'terminal',
      result: ambiguousResult,
    });
  });

  it('settles deadline expiry between prepare and claim without resolving credentials', async () => {
    const expiredRequest = { ...request, deadlineAt: '2000-01-01T00:00:00.000Z' };
    const { service, repository, toolRegistry } = createHarness({
      requestForDispatch: expiredRequest,
    });
    const result = await service.claimComponentDispatch(ref);

    expect(result.kind).toBe('terminal');
    expect(repository.reconcileDispatchFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        ref,
        cause: 'deadline',
      }),
    );
    expect(toolRegistry.resolveComponentForDispatch).not.toHaveBeenCalled();
  });

  it('requires the live source, component registry entry, and immutable fingerprint before claim', async () => {
    const { service, toolRegistry, repository } = createHarness();
    toolRegistry.resolveComponentForDispatch.mockRejectedValueOnce(
      new ConflictException('binding changed'),
    );

    await expect(service.claimComponentDispatch(ref)).rejects.toBeInstanceOf(ConflictException);
    expect(repository.claimAttempt).not.toHaveBeenCalled();
  });

  it('settles complete/fail/ambiguous and rejects conflicting result identities', async () => {
    const { service } = createHarness();
    await expect(service.complete(ref, completedResult)).resolves.toEqual(completedResult);
    const failed: ToolInvocationResult = {
      invocationId: INVOCATION_ID,
      status: 'failed',
      error: { class: 'remote-tool', message: 'failed', retryable: false },
      completedAt: '2099-07-31T10:01:00.000Z',
    };
    await expect(service.fail(ref, failed)).resolves.toEqual(failed);
    await expect(
      service.ambiguous(ref, 'lease lost', '2099-07-31T10:01:00.000Z'),
    ).resolves.toMatchObject({ status: 'ambiguous' });
    await expect(
      service.complete(ref, {
        ...completedResult,
        invocationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('delegates state-aware attempt and run reconciliation through strict inputs', async () => {
    const { service, repository } = createHarness();
    await service.reconcileDispatchFailure({
      ref,
      cause: 'failure',
      message: 'activity failed',
      completedAt: '2099-07-31T10:01:00.000Z',
    });
    await service.reconcileRunInvocations({
      runId: 'run-1',
      message: 'run finalized',
      completedAt: '2099-07-31T10:02:00.000Z',
    });
    expect(repository.reconcileDispatchFailure).toHaveBeenCalledWith(
      expect.objectContaining({ cause: 'failure' }),
    );
    expect(repository.reconcileRunInvocations).toHaveBeenCalledWith({
      runId: 'run-1',
      message: 'run finalized',
      completedAt: '2099-07-31T10:02:00.000Z',
    });
  });
});
