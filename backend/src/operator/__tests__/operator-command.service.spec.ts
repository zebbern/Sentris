import { beforeEach, describe, expect, it, vi } from 'bun:test';

import type { AuthContext } from '../../auth/types';
import type { FindingsQueryService } from '../../analytics/findings-query.service';
import type { FindingTriageService } from '../../findings/finding-triage.service';
import type { WorkflowsService } from '../../workflows/workflows.service';
import { OperatorCommandService } from '../operator-command.service';
import type { OperatorMcpAuthorityService } from '../operator-mcp-authority.service';

const WORKFLOW_ID = '11111111-1111-4111-8111-111111111111';
const WORKFLOW_VERSION_ID = '66666666-6666-4666-8666-666666666666';
const ACTION_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const TURN_ID = '44444444-4444-4444-8444-444444444444';
const FINDING_ID = 'fo_v1_test-finding';
const SNAPSHOT_ID = '55555555-5555-4555-8555-555555555555';

const auth: AuthContext = {
  userId: 'operator-user',
  organizationId: 'operator-org',
  roles: ['MEMBER'],
  isAuthenticated: true,
  provider: 'operator',
};

describe('OperatorCommandService', () => {
  let workflows: Record<string, ReturnType<typeof vi.fn>>;
  let findings: Record<string, ReturnType<typeof vi.fn>>;
  let triage: Record<string, ReturnType<typeof vi.fn>>;
  let mcpAuthority: Record<string, ReturnType<typeof vi.fn>>;
  let service: OperatorCommandService;

  beforeEach(() => {
    workflows = {
      run: vi.fn().mockResolvedValue({
        runId: 'sentris-run-1',
        workflowId: WORKFLOW_ID,
        temporalRunId: 'temporal-1',
        status: 'RUNNING',
      }),
    };
    findings = {
      listFindings: vi.fn().mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
        availability: 'available',
        paginationMode: 'offset',
        currentCursor: null,
        nextCursor: null,
        schemaCoverage: { canonical: 0, legacy: 0, invalid: 0 },
        degradedReasons: [],
      }),
      getFinding: vi.fn(),
    };
    triage = { upsertTriage: vi.fn() };
    mcpAuthority = {
      listServers: vi.fn(),
      materialize: vi.fn(),
      createOperationRequest: vi.fn(),
    };
    service = new OperatorCommandService(
      workflows as unknown as WorkflowsService,
      findings as unknown as FindingsQueryService,
      triage as unknown as FindingTriageService,
      mcpAuthority as unknown as OperatorMcpAuthorityService,
    );
  });

  it('uses the stable session and action identity as the workflow idempotency key', async () => {
    const result = await service.execute({
      commandName: 'run_workflow',
      arguments: {
        workflowId: WORKFLOW_ID,
        versionId: WORKFLOW_VERSION_ID,
        inputs: { target: 'example.com' },
      },
      auth,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      turnCreatedAt: '2026-08-02T10:00:00.000Z',
      actionId: ACTION_ID,
      actionRequestedAt: '2026-08-02T10:01:00.000Z',
    });

    expect(workflows.run).toHaveBeenCalledWith(
      WORKFLOW_ID,
      { inputs: { target: 'example.com' }, versionId: WORKFLOW_VERSION_ID },
      auth,
      {
        idempotencyKey: `operator:${SESSION_ID}:${ACTION_ID}`,
        trigger: { type: 'api', sourceId: ACTION_ID, label: 'Sentris Operator' },
      },
    );
    expect(result.runId).toBe('sentris-run-1');
  });

  it('returns the exact selected-version runtime input contract before a run', async () => {
    const versionId = '88888888-8888-4888-8888-888888888888';
    workflows.getCompiledWorkflowContext = vi.fn().mockResolvedValue({
      workflow: {
        id: WORKFLOW_ID,
        name: 'npm investigation',
        description: 'Investigate one npm package',
      },
      version: {
        id: versionId,
        version: 4,
        graph: {
          nodes: [{ id: 'entry', type: 'core.workflow.entrypoint', data: { label: 'Start' } }],
          edges: [],
        },
      },
      definition: {
        entrypoint: { ref: 'entry' },
        actions: [
          {
            ref: 'entry',
            componentId: 'core.workflow.entrypoint',
            params: {
              runtimeInputs: [
                {
                  id: 'packageSpec',
                  label: 'npm package and optional version',
                  description: 'For example minimist@1.2.5',
                  type: 'text',
                  required: true,
                },
                {
                  id: 'token',
                  label: 'Private token',
                  type: 'secret',
                  required: false,
                  defaultValue: 'must-not-enter-model-context',
                },
              ],
            },
          },
        ],
      },
    });

    const result = await service.execute({
      commandName: 'get_workflow',
      arguments: { workflowId: WORKFLOW_ID, version: 4 },
      auth,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      turnCreatedAt: '2026-08-02T10:00:00.000Z',
      actionId: ACTION_ID,
      actionRequestedAt: '2026-08-02T10:01:00.000Z',
    });

    expect(workflows.getCompiledWorkflowContext).toHaveBeenCalledWith(
      WORKFLOW_ID,
      { version: 4 },
      auth,
    );
    expect(result.result).toEqual(
      expect.objectContaining({
        id: WORKFLOW_ID,
        versionId,
        version: 4,
        runtimeInputs: [
          expect.objectContaining({
            id: 'packageSpec',
            type: 'text',
            required: true,
            hasDefaultValue: false,
          }),
          expect.objectContaining({
            id: 'token',
            type: 'secret',
            required: false,
            hasDefaultValue: true,
          }),
        ],
      }),
    );
    expect(JSON.stringify(result.result)).not.toContain('must-not-enter-model-context');
  });

  it('retries one terminal run from its stored version, inputs, and scope exactly once', async () => {
    workflows.getRun = vi.fn().mockResolvedValue({
      id: 'sentris-run-original',
      workflowId: WORKFLOW_ID,
      temporalRunId: 'temporal-original',
      status: 'FAILED',
      scopeId: '55555555-5555-4555-8555-555555555555',
    });
    workflows.getRunConfig = vi.fn().mockResolvedValue({
      runId: 'sentris-run-original',
      workflowId: WORKFLOW_ID,
      workflowVersionId: '66666666-6666-4666-8666-666666666666',
      workflowVersion: 4,
      inputs: { target: 'example.com' },
    });

    const result = await service.execute({
      commandName: 'retry_run',
      arguments: { runId: 'sentris-run-original' },
      auth,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      turnCreatedAt: '2026-08-02T10:00:00.000Z',
      actionId: ACTION_ID,
      actionRequestedAt: '2026-08-02T10:01:00.000Z',
    });

    expect(workflows.run).toHaveBeenCalledWith(
      WORKFLOW_ID,
      {
        inputs: { target: 'example.com' },
        versionId: '66666666-6666-4666-8666-666666666666',
        scopeId: '55555555-5555-4555-8555-555555555555',
      },
      auth,
      {
        idempotencyKey: `operator-retry:${SESSION_ID}:${ACTION_ID}`,
        trigger: {
          type: 'api',
          sourceId: ACTION_ID,
          label: 'Sentris Operator retry',
        },
      },
    );
    expect(result).toEqual(expect.objectContaining({ runId: 'sentris-run-1' }));
  });

  it('does not call an active run a retry', async () => {
    workflows.getRun = vi.fn().mockResolvedValue({
      id: 'sentris-run-active',
      workflowId: WORKFLOW_ID,
      status: 'RUNNING',
      scopeId: null,
    });
    workflows.getRunConfig = vi.fn().mockResolvedValue({
      runId: 'sentris-run-active',
      workflowId: WORKFLOW_ID,
      workflowVersionId: null,
      workflowVersion: null,
      inputs: {},
    });

    await expect(
      service.execute({
        commandName: 'retry_run',
        arguments: { runId: 'sentris-run-active' },
        auth,
        sessionId: SESSION_ID,
        turnId: TURN_ID,
        turnCreatedAt: '2026-08-02T10:00:00.000Z',
        actionId: ACTION_ID,
        actionRequestedAt: '2026-08-02T10:01:00.000Z',
      }),
    ).rejects.toThrow('is still RUNNING');
    expect(workflows.run).not.toHaveBeenCalled();
  });

  it('uses the canonical findings query with bounded Operator filters', async () => {
    await service.execute({
      commandName: 'list_findings',
      arguments: { severity: 'high', triageStatus: 'new', limit: 12 },
      auth,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      turnCreatedAt: '2026-08-02T10:00:00.000Z',
      actionId: ACTION_ID,
      actionRequestedAt: '2026-08-02T10:01:00.000Z',
    });

    expect(findings.listFindings).toHaveBeenCalledWith(
      auth,
      expect.objectContaining({
        severity: 'high',
        triageStatus: 'new',
        page: 1,
        pageSize: 12,
        paginationMode: 'offset',
      }),
    );
  });

  it('delegates explicit triage changes to the canonical domain service as the Operator actor', async () => {
    triage.upsertTriage.mockResolvedValue({
      findingOpensearchId: FINDING_ID,
      status: 'triaged',
    });

    const result = await service.execute({
      commandName: 'update_finding_triage',
      arguments: {
        findingId: FINDING_ID,
        status: 'triaged',
        comment: 'Operator-confirmed triage',
      },
      auth,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      turnCreatedAt: '2026-08-02T10:00:00.000Z',
      actionId: ACTION_ID,
      actionRequestedAt: '2026-08-02T10:01:00.000Z',
    });

    expect(triage.upsertTriage).toHaveBeenCalledWith(
      auth,
      FINDING_ID,
      { status: 'triaged', comment: 'Operator-confirmed triage' },
      'operator',
    );
    expect(result.result).toEqual({
      findingOpensearchId: FINDING_ID,
      status: 'triaged',
    });
  });

  it('returns an authority-bound deferred MCP request without dispatching in the backend', async () => {
    const request = {
      invocationId: ACTION_ID,
      scope: {
        kind: 'operator' as const,
        organizationId: 'operator-org',
        sessionId: SESSION_ID,
        turnId: TURN_ID,
        capabilityGrantId: '66666666-6666-4666-8666-666666666666',
        expiresAt: '2099-08-02T11:00:00.000Z',
      },
      capabilitySnapshotId: SNAPSHOT_ID,
      sourceId: 'saved-server-1',
      authorizationTarget: 'search',
      operation: { kind: 'tool-call' as const, name: 'search', arguments: { query: 'npm' } },
      requestedAt: '2099-08-02T10:00:00.000Z',
      deadlineAt: '2099-08-02T10:10:00.000Z',
    };
    mcpAuthority.createOperationRequest.mockResolvedValue(request);

    const result = await service.execute({
      commandName: 'invoke_mcp_tool',
      arguments: {
        capabilitySnapshotId: SNAPSHOT_ID,
        sourceId: 'saved-server-1',
        name: 'search',
        arguments: { query: 'npm' },
      },
      auth,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      turnCreatedAt: '2099-08-02T09:59:00.000Z',
      actionId: ACTION_ID,
      actionRequestedAt: '2099-08-02T10:00:00.000Z',
    });

    expect(result.mcpOperationRequest).toEqual(request);
    expect(result.result).toEqual(
      expect.objectContaining({ kind: 'mcp-operation', state: 'ready_for_dispatch' }),
    );
  });
});
