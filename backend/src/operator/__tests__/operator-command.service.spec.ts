import { beforeEach, describe, expect, it, vi } from 'bun:test';

import type { AuthContext } from '../../auth/types';
import type { FindingsQueryService } from '../../analytics/findings-query.service';
import type { FindingTriageService } from '../../findings/finding-triage.service';
import type { ArtifactsService } from '../../storage/artifacts.service';
import type { TraceService } from '../../trace/trace.service';
import type { WorkflowsService } from '../../workflows/workflows.service';
import { OperatorCommandService } from '../operator-command.service';
import type { OperatorMcpAuthorityService } from '../operator-mcp-authority.service';
import type { OperatorWorkflowAuthoringService } from '../operator-workflow-authoring.service';

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
  let workflowAuthoring: Record<string, ReturnType<typeof vi.fn>>;
  let trace: Record<string, ReturnType<typeof vi.fn>>;
  let artifacts: Record<string, ReturnType<typeof vi.fn>>;
  let service: OperatorCommandService;

  beforeEach(() => {
    workflows = {
      run: vi.fn().mockResolvedValue({
        runId: 'sentris-run-1',
        workflowId: WORKFLOW_ID,
        temporalRunId: 'temporal-1',
        status: 'RUNNING',
      }),
      getWorkflowVersion: vi
        .fn()
        .mockImplementation((_workflowId: string, versionId: string) =>
          Promise.resolve({ id: versionId, graph: { successCriteria: [] } }),
        ),
      promoteVersion: vi.fn().mockResolvedValue({
        workflowId: WORKFLOW_ID,
        id: WORKFLOW_VERSION_ID,
        version: 4,
        name: 'Improved workflow',
        alreadyCurrent: false,
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
    workflowAuthoring = {
      listComponents: vi.fn(),
      getComponent: vi.fn(),
      getDraftDetail: vi.fn(),
      projectGraph: vi.fn((graph) => graph),
      propose: vi.fn(),
      proposeEdits: vi.fn(),
      revise: vi.fn(),
      apply: vi.fn(),
    };
    trace = {
      summarizeRun: vi.fn().mockResolvedValue({
        totalEvents: 0,
        failedEventCount: 0,
        failed: [],
        recent: [],
      }),
    };
    artifacts = {
      listRunArtifacts: vi.fn().mockResolvedValue({ runId: 'sentris-run-1', artifacts: [] }),
    };
    service = new OperatorCommandService(
      workflows as unknown as WorkflowsService,
      findings as unknown as FindingsQueryService,
      triage as unknown as FindingTriageService,
      mcpAuthority as unknown as OperatorMcpAuthorityService,
      workflowAuthoring as unknown as OperatorWorkflowAuthoringService,
      trace as unknown as TraceService,
      artifacts as unknown as ArtifactsService,
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

  it('validates reviewed input changes and preserves stored secrets and scope on launch', async () => {
    const sourceRunId = 'sentris-run-input-source';
    const scopeId = '77777777-7777-4777-8777-777777777777';
    workflows.getRun = vi.fn().mockResolvedValue({
      id: sourceRunId,
      workflowId: WORKFLOW_ID,
      status: 'COMPLETED',
      scopeId,
    });
    workflows.getRunConfig = vi.fn().mockResolvedValue({
      runId: sourceRunId,
      workflowId: WORKFLOW_ID,
      workflowVersionId: WORKFLOW_VERSION_ID,
      workflowVersion: 1,
      inputs: { target: 'old.example.com', apiKey: 'stored-secret' },
    });
    workflows.getCompiledWorkflowContext = vi.fn().mockResolvedValue({
      workflow: { id: WORKFLOW_ID },
      version: { id: WORKFLOW_VERSION_ID },
      definition: {
        entrypoint: { ref: 'entry' },
        actions: [
          {
            ref: 'entry',
            componentId: 'core.workflow.entrypoint',
            params: {
              runtimeInputs: [
                { id: 'target', label: 'Target', type: 'text', required: true },
                { id: 'apiKey', label: 'API key', type: 'secret', required: true },
              ],
            },
          },
        ],
      },
    });
    const inputChanges = [
      { operation: 'set' as const, inputId: 'target', value: 'new.example.com' },
    ];

    const proposal = await service.execute({
      commandName: 'propose_run_input_changes',
      arguments: { sourceRunId, changes: inputChanges },
      auth,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      turnCreatedAt: '2026-08-02T10:00:00.000Z',
      actionId: ACTION_ID,
      actionRequestedAt: '2026-08-02T10:01:00.000Z',
    });
    expect(proposal.result).toEqual(
      expect.objectContaining({
        kind: 'run-input-proposal',
        sourceRunId,
        workflowId: WORKFLOW_ID,
        versionId: WORKFLOW_VERSION_ID,
        changes: [
          expect.objectContaining({
            inputId: 'target',
            before: 'old.example.com',
            after: 'new.example.com',
          }),
        ],
      }),
    );
    expect(JSON.stringify(proposal.result)).not.toContain('stored-secret');

    await service.execute({
      commandName: 'run_workflow',
      arguments: {
        workflowId: WORKFLOW_ID,
        versionId: WORKFLOW_VERSION_ID,
        inputs: {},
        sourceRunId,
        inputChanges,
      },
      auth,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      turnCreatedAt: '2026-08-02T10:02:00.000Z',
      actionId: ACTION_ID,
      actionRequestedAt: '2026-08-02T10:03:00.000Z',
    });
    expect(workflows.run).toHaveBeenCalledWith(
      WORKFLOW_ID,
      {
        inputs: { target: 'new.example.com', apiKey: 'stored-secret' },
        versionId: WORKFLOW_VERSION_ID,
        scopeId,
      },
      auth,
      expect.any(Object),
    );
  });

  it('rejects Operator changes to declared secret runtime inputs', async () => {
    const sourceRunId = 'sentris-run-secret-source';
    workflows.getRun = vi.fn().mockResolvedValue({
      id: sourceRunId,
      workflowId: WORKFLOW_ID,
      status: 'COMPLETED',
      scopeId: null,
    });
    workflows.getRunConfig = vi.fn().mockResolvedValue({
      runId: sourceRunId,
      workflowId: WORKFLOW_ID,
      workflowVersionId: WORKFLOW_VERSION_ID,
      workflowVersion: 1,
      inputs: { apiKey: 'stored-secret' },
    });
    workflows.getCompiledWorkflowContext = vi.fn().mockResolvedValue({
      workflow: { id: WORKFLOW_ID },
      version: { id: WORKFLOW_VERSION_ID },
      definition: {
        entrypoint: { ref: 'entry' },
        actions: [
          {
            ref: 'entry',
            componentId: 'core.workflow.entrypoint',
            params: {
              runtimeInputs: [{ id: 'apiKey', label: 'API key', type: 'secret', required: true }],
            },
          },
        ],
      },
    });

    await expect(
      service.execute({
        commandName: 'propose_run_input_changes',
        arguments: {
          sourceRunId,
          changes: [{ operation: 'set', inputId: 'apiKey', value: 'replacement' }],
        },
        auth,
        sessionId: SESSION_ID,
        turnId: TURN_ID,
        turnCreatedAt: '2026-08-02T10:00:00.000Z',
        actionId: ACTION_ID,
        actionRequestedAt: '2026-08-02T10:01:00.000Z',
      }),
    ).rejects.toThrow('is preserved and cannot be changed');
    expect(workflows.run).not.toHaveBeenCalled();
  });

  it('promotes an explicitly kept candidate version through the canonical workflow service', async () => {
    workflows.getRun = vi.fn().mockResolvedValue({
      id: 'sentris-run-candidate',
      workflowId: WORKFLOW_ID,
      workflowVersionId: WORKFLOW_VERSION_ID,
      status: 'COMPLETED',
    });
    const result = await service.execute({
      commandName: 'promote_workflow_version',
      arguments: {
        workflowId: WORKFLOW_ID,
        versionId: WORKFLOW_VERSION_ID,
        baseVersionId: '55555555-5555-4555-8555-555555555555',
        candidateRunId: 'sentris-run-candidate',
      },
      auth,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      turnCreatedAt: '2026-08-02T10:00:00.000Z',
      actionId: ACTION_ID,
      actionRequestedAt: '2026-08-02T10:01:00.000Z',
    });

    expect(workflows.promoteVersion).toHaveBeenCalledWith(WORKFLOW_ID, WORKFLOW_VERSION_ID, auth, {
      candidateRunId: 'sentris-run-candidate',
      expectedCurrentVersionId: '55555555-5555-4555-8555-555555555555',
    });
    expect(result.result).toEqual({
      kind: 'workflow-version-promoted',
      workflowId: WORKFLOW_ID,
      versionId: WORKFLOW_VERSION_ID,
      version: 4,
      name: 'Improved workflow',
      candidateRunId: 'sentris-run-candidate',
      alreadyCurrent: false,
    });
  });

  it('dispatches compact workflow edits through the canonical authoring service', async () => {
    const proposal = {
      kind: 'workflow-draft',
      draftId: ACTION_ID,
      mode: 'update',
      workflowId: WORKFLOW_ID,
      baseVersionId: WORKFLOW_VERSION_ID,
      name: 'Updated workflow',
      digest: 'digest',
      validation: { valid: true, errors: [] },
      diff: {
        metadataChanged: [],
        addedNodeIds: [],
        removedNodeIds: [],
        changedNodeIds: ['agent'],
        addedEdgeIds: [],
        removedEdgeIds: [],
        changedEdgeIds: [],
      },
    };
    workflowAuthoring.proposeEdits.mockResolvedValue(proposal);
    const argumentsValue = {
      workflowId: WORKFLOW_ID,
      baseVersionId: WORKFLOW_VERSION_ID,
      operations: [
        {
          operation: 'patch_node' as const,
          nodeId: 'agent',
          setParameters: { modelId: 'gemini-2.5-pro' },
        },
      ],
    };

    const result = await service.execute({
      commandName: 'propose_workflow_edits',
      arguments: argumentsValue,
      auth,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      turnCreatedAt: '2026-08-02T10:00:00.000Z',
      actionId: ACTION_ID,
      actionRequestedAt: '2026-08-02T10:01:00.000Z',
    });

    expect(workflowAuthoring.proposeEdits).toHaveBeenCalledWith({
      arguments: argumentsValue,
      auth,
      actionId: ACTION_ID,
    });
    expect(result.result).toEqual(proposal);
  });

  it('dispatches draft inspection and bounded revision through the canonical authoring service', async () => {
    const draftId = '55555555-5555-4555-8555-555555555555';
    const detail = { kind: 'workflow-draft', draftId, validation: { valid: false } };
    workflowAuthoring.getDraftDetail.mockResolvedValue(detail);

    const inspected = await service.execute({
      commandName: 'get_workflow_draft',
      arguments: { draftId },
      auth,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      turnCreatedAt: '2026-08-02T10:00:00.000Z',
      actionId: ACTION_ID,
      actionRequestedAt: '2026-08-02T10:01:00.000Z',
    });

    expect(workflowAuthoring.getDraftDetail).toHaveBeenCalledWith({
      draftId,
      sessionId: SESSION_ID,
      auth,
    });
    expect(inspected.result).toBe(detail);

    const argumentsValue = {
      draftId,
      operations: [{ operation: 'remove_edge' as const, edgeId: 'invalid-edge' }],
    };
    const revision = { ...detail, draftId: ACTION_ID, parentDraftId: draftId };
    workflowAuthoring.revise.mockResolvedValue(revision);
    const revised = await service.execute({
      commandName: 'revise_workflow_draft',
      arguments: argumentsValue,
      auth,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      turnCreatedAt: '2026-08-02T10:00:00.000Z',
      actionId: ACTION_ID,
      actionRequestedAt: '2026-08-02T10:01:00.000Z',
    });

    expect(workflowAuthoring.revise).toHaveBeenCalledWith({
      arguments: argumentsValue,
      auth,
      sessionId: SESSION_ID,
      actionId: ACTION_ID,
    });
    expect(revised.result).toBe(revision);
  });

  it('runs an improved version with the terminal source run inputs and scope', async () => {
    const sourceRunId = 'sentris-run-source';
    const scopeId = '77777777-7777-4777-8777-777777777777';
    workflows.getRun = vi.fn().mockResolvedValue({
      id: sourceRunId,
      workflowId: WORKFLOW_ID,
      status: 'FAILED',
      scopeId,
    });
    workflows.getRunConfig = vi.fn().mockResolvedValue({
      runId: sourceRunId,
      workflowId: WORKFLOW_ID,
      workflowVersionId: '88888888-8888-4888-8888-888888888888',
      workflowVersion: 3,
      inputs: { packageSpec: 'minimist@1.2.8' },
    });

    const result = await service.execute({
      commandName: 'run_workflow',
      arguments: {
        workflowId: WORKFLOW_ID,
        versionId: WORKFLOW_VERSION_ID,
        sourceRunId,
        inputs: {},
      },
      auth,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      turnCreatedAt: '2026-08-02T10:00:00.000Z',
      actionId: ACTION_ID,
      actionRequestedAt: '2026-08-02T10:01:00.000Z',
    });

    expect(workflows.getRun).toHaveBeenCalledWith(sourceRunId, auth);
    expect(workflows.getRunConfig).toHaveBeenCalledWith(sourceRunId, auth);
    expect(workflows.run).toHaveBeenCalledWith(
      WORKFLOW_ID,
      {
        inputs: { packageSpec: 'minimist@1.2.8' },
        versionId: WORKFLOW_VERSION_ID,
        scopeId,
      },
      auth,
      {
        idempotencyKey: `operator:${SESSION_ID}:${ACTION_ID}`,
        trigger: { type: 'api', sourceId: ACTION_ID, label: 'Sentris Operator' },
      },
    );
    expect(result).toEqual(
      expect.objectContaining({
        runId: 'sentris-run-1',
        result: expect.objectContaining({ sourceRunId }),
      }),
    );
  });

  it('rejects an active source run before launching an improved version', async () => {
    const sourceRunId = 'sentris-run-active-source';
    workflows.getRun = vi.fn().mockResolvedValue({
      id: sourceRunId,
      workflowId: WORKFLOW_ID,
      status: 'RUNNING',
      scopeId: null,
    });
    workflows.getRunConfig = vi.fn().mockResolvedValue({
      runId: sourceRunId,
      workflowId: WORKFLOW_ID,
      workflowVersionId: WORKFLOW_VERSION_ID,
      workflowVersion: 3,
      inputs: { target: 'example.com' },
    });

    await expect(
      service.execute({
        commandName: 'run_workflow',
        arguments: { workflowId: WORKFLOW_ID, versionId: WORKFLOW_VERSION_ID, sourceRunId },
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

  it('returns bounded terminal trace and run-scoped finding evidence', async () => {
    const runId = 'sentris-run-failed';
    workflows.getRun = vi.fn().mockResolvedValue({
      id: runId,
      workflowId: WORKFLOW_ID,
      temporalRunId: 'temporal-failed',
      status: 'FAILED',
    });
    workflows.getRunStatus = vi.fn().mockResolvedValue({ status: 'FAILED' });
    workflows.getRunResult = vi.fn().mockResolvedValue({ status: 'FAILED', result: null });
    const traceEvents = Array.from({ length: 14 }, (_, index) => ({
      id: String(index + 1),
      runId,
      nodeId: `node-${index + 1}`,
      type: 'FAILED',
      level: 'error',
      timestamp: `2026-08-02T10:00:${String(index).padStart(2, '0')}.000Z`,
      message: index === 13 ? 'x'.repeat(3_000) : `Failure ${index + 1}`,
      error: {
        message: `Component failure ${index + 1}`,
        stack: 'stack-must-not-enter-operator-context',
        details: { response: 'y'.repeat(5_000) },
      },
      outputSummary: { statusCode: 500 },
    }));
    trace.summarizeRun.mockResolvedValue({
      totalEvents: 14,
      failedEventCount: 14,
      failed: traceEvents.slice(-8),
      recent: traceEvents.slice(-8),
    });
    findings.listFindings.mockResolvedValue({
      items: [
        {
          id: FINDING_ID,
          name: 'Exposed package token',
          severity: 'high',
          run_id: runId,
          raw: { credential: 'raw-must-not-enter-operator-context' },
        },
      ],
      total: 1,
      page: 1,
      pageSize: 10,
      availability: 'available',
      paginationMode: 'offset',
      currentCursor: null,
      nextCursor: null,
      schemaCoverage: { canonical: 1, legacy: 0, invalid: 0 },
      degradedReasons: [],
    });
    artifacts.listRunArtifacts.mockResolvedValue({
      runId,
      artifacts: [
        {
          id: '77777777-7777-4777-8777-777777777777',
          runId,
          workflowId: WORKFLOW_ID,
          workflowVersionId: WORKFLOW_VERSION_ID,
          componentRef: 'report',
          fileId: '88888888-8888-4888-8888-888888888888',
          name: 'report.json',
          mimeType: 'application/json',
          size: 512,
          destinations: ['run'],
          metadata: { internal: 'not-needed-by-operator' },
          createdAt: '2026-08-02T10:01:00.000Z',
        },
      ],
    });

    const response = await service.execute({
      commandName: 'get_run',
      arguments: { runId },
      auth,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      turnCreatedAt: '2026-08-02T10:00:00.000Z',
      actionId: ACTION_ID,
      actionRequestedAt: '2026-08-02T10:01:00.000Z',
    });
    const result = response.result as any;

    expect(trace.summarizeRun).toHaveBeenCalledWith(
      runId,
      { failedLimit: 8, recentLimit: 8 },
      auth,
    );
    expect(findings.listFindings).toHaveBeenCalledWith(
      auth,
      expect.objectContaining({
        runId,
        page: 1,
        pageSize: 10,
        sortOrder: 'desc',
        paginationMode: 'offset',
      }),
    );
    expect(result.diagnostics.trace).toEqual(
      expect.objectContaining({
        availability: 'available',
        totalEvents: 14,
        failedEventCount: 14,
      }),
    );
    expect(result.diagnostics.trace.failed).toHaveLength(8);
    expect(result.diagnostics.trace.recent).toHaveLength(8);
    expect(result.diagnostics.trace.recent.at(-1).message).toEndWith('…');
    expect(result.diagnostics.findings).toEqual(
      expect.objectContaining({
        availability: 'available',
        total: 1,
        items: [expect.objectContaining({ id: FINDING_ID })],
      }),
    );
    expect(result.diagnostics.artifacts).toEqual({
      availability: 'available',
      total: 1,
      items: [expect.objectContaining({ name: 'report.json' })],
    });
    expect(JSON.stringify(result.diagnostics.artifacts)).not.toContain('not-needed-by-operator');
    expect(JSON.stringify(result)).not.toContain('stack-must-not-enter-operator-context');
    expect(JSON.stringify(result)).not.toContain('raw-must-not-enter-operator-context');
  });

  it('keeps terminal run inspection available when diagnostic sources are unavailable', async () => {
    const runId = 'sentris-run-diagnostics-unavailable';
    workflows.getRun = vi.fn().mockResolvedValue({
      id: runId,
      workflowId: WORKFLOW_ID,
      temporalRunId: 'temporal-failed',
      status: 'FAILED',
    });
    workflows.getRunStatus = vi.fn().mockResolvedValue({ status: 'FAILED' });
    workflows.getRunResult = vi.fn().mockResolvedValue({ status: 'FAILED', result: null });
    trace.summarizeRun.mockRejectedValue(new Error('trace store unavailable'));
    findings.listFindings.mockRejectedValue(new Error('finding index unavailable'));
    artifacts.listRunArtifacts.mockRejectedValue(new Error('artifact store unavailable'));

    const response = await service.execute({
      commandName: 'get_run',
      arguments: { runId },
      auth,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      turnCreatedAt: '2026-08-02T10:00:00.000Z',
      actionId: ACTION_ID,
      actionRequestedAt: '2026-08-02T10:01:00.000Z',
    });

    expect(response.result).toEqual(
      expect.objectContaining({
        terminal: true,
        result: { status: 'FAILED', result: null },
        diagnostics: {
          trace: { availability: 'unavailable', error: 'trace store unavailable' },
          findings: {
            availability: 'unavailable',
            total: null,
            items: [],
            error: 'finding index unavailable',
          },
          artifacts: {
            availability: 'unavailable',
            total: null,
            items: [],
            error: 'artifact store unavailable',
          },
        },
      }),
    );
  });

  it('does not load terminal diagnostics for an active run', async () => {
    const runId = 'sentris-run-active';
    workflows.getRun = vi.fn().mockResolvedValue({
      id: runId,
      workflowId: WORKFLOW_ID,
      temporalRunId: 'temporal-active',
      status: 'RUNNING',
    });
    workflows.getRunStatus = vi.fn().mockResolvedValue({ status: 'RUNNING' });
    workflows.getRunResult = vi.fn();

    const response = await service.execute({
      commandName: 'get_run',
      arguments: { runId },
      auth,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      turnCreatedAt: '2026-08-02T10:00:00.000Z',
      actionId: ACTION_ID,
      actionRequestedAt: '2026-08-02T10:01:00.000Z',
    });

    expect(response.result).toEqual(
      expect.objectContaining({ terminal: false, status: { status: 'RUNNING' } }),
    );
    expect(workflows.getRunResult).not.toHaveBeenCalled();
    expect(trace.summarizeRun).not.toHaveBeenCalled();
    expect(findings.listFindings).not.toHaveBeenCalled();
  });

  it('compares an improved run with its source using terminal and exact diagnostic evidence', async () => {
    const sourceRunId = 'sentris-run-source';
    const candidateRunId = 'sentris-run-candidate';
    workflows.getRun = vi.fn().mockImplementation((runId: string) =>
      Promise.resolve({
        id: runId,
        workflowId: WORKFLOW_ID,
        workflowVersionId:
          runId === sourceRunId
            ? '77777777-7777-4777-8777-777777777777'
            : '88888888-8888-4888-8888-888888888888',
        status: runId === sourceRunId ? 'FAILED' : 'COMPLETED',
        duration: runId === sourceRunId ? 10_000 : 8_000,
        scopeId: '55555555-5555-4555-8555-555555555555',
      }),
    );
    workflows.getRunConfig = vi.fn().mockImplementation((runId: string) =>
      Promise.resolve({
        runId,
        workflowId: WORKFLOW_ID,
        workflowVersionId:
          runId === sourceRunId
            ? '77777777-7777-4777-8777-777777777777'
            : '88888888-8888-4888-8888-888888888888',
        workflowVersion: runId === sourceRunId ? 1 : 2,
        inputs: { target: 'example.com' },
      }),
    );
    trace.summarizeRun.mockImplementation((runId: string) =>
      Promise.resolve({
        totalEvents: 4,
        failedEventCount: runId === sourceRunId ? 2 : 0,
        failed: [],
        recent: [],
      }),
    );
    findings.listFindings.mockImplementation((_auth: AuthContext, query: { runId: string }) =>
      Promise.resolve({
        items: [],
        total: query.runId === sourceRunId ? 1 : 2,
        page: 1,
        pageSize: 10,
        availability: 'available',
        paginationMode: 'offset',
        currentCursor: null,
        nextCursor: null,
        schemaCoverage: { canonical: 1, legacy: 0, invalid: 0 },
        degradedReasons: [],
      }),
    );

    const response = await service.execute({
      commandName: 'compare_runs',
      arguments: { sourceRunId, candidateRunId },
      auth,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      turnCreatedAt: '2026-08-02T10:00:00.000Z',
      actionId: ACTION_ID,
      actionRequestedAt: '2026-08-02T10:01:00.000Z',
    });

    expect(response.result).toEqual(
      expect.objectContaining({
        kind: 'run-comparison',
        assessment: 'improved',
        comparable: true,
        source: expect.objectContaining({
          runId: sourceRunId,
          status: 'FAILED',
          trace: { availability: 'available', failedEventCount: 2 },
          findings: { availability: 'available', total: 1 },
        }),
        candidate: expect.objectContaining({
          runId: candidateRunId,
          status: 'COMPLETED',
          trace: { availability: 'available', failedEventCount: 0 },
          findings: { availability: 'available', total: 2 },
        }),
        changes: {
          statusChanged: true,
          failedEventCountDelta: -2,
          findingTotalDelta: 1,
          durationDeltaMs: -2_000,
        },
      }),
    );
  });

  it('marks runs with different inputs as inconclusive instead of claiming improvement', async () => {
    const sourceRunId = 'sentris-run-source';
    const candidateRunId = 'sentris-run-candidate';
    workflows.getRun = vi.fn().mockImplementation((runId: string) =>
      Promise.resolve({
        id: runId,
        workflowId: WORKFLOW_ID,
        workflowVersionId: WORKFLOW_VERSION_ID,
        status: runId === sourceRunId ? 'FAILED' : 'COMPLETED',
        duration: 1_000,
        scopeId: null,
      }),
    );
    workflows.getRunConfig = vi.fn().mockImplementation((runId: string) =>
      Promise.resolve({
        runId,
        workflowId: WORKFLOW_ID,
        workflowVersionId: WORKFLOW_VERSION_ID,
        workflowVersion: 1,
        inputs: { target: runId },
      }),
    );

    const response = await service.execute({
      commandName: 'compare_runs',
      arguments: { sourceRunId, candidateRunId },
      auth,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      turnCreatedAt: '2026-08-02T10:00:00.000Z',
      actionId: ACTION_ID,
      actionRequestedAt: '2026-08-02T10:01:00.000Z',
    });

    expect(response.result).toEqual(
      expect.objectContaining({
        assessment: 'inconclusive',
        comparable: false,
        caveats: expect.arrayContaining([expect.stringContaining('different stored inputs')]),
      }),
    );
  });

  it('uses candidate-version success criteria to compare semantic run outputs', async () => {
    const sourceRunId = 'sentris-run-source';
    const candidateRunId = 'sentris-run-candidate';
    const candidateVersionId = '88888888-8888-4888-8888-888888888888';
    workflows.getRun = vi.fn().mockImplementation((runId: string) =>
      Promise.resolve({
        id: runId,
        workflowId: WORKFLOW_ID,
        workflowVersionId:
          runId === sourceRunId ? '77777777-7777-4777-8777-777777777777' : candidateVersionId,
        temporalRunId: `temporal-${runId}`,
        status: 'COMPLETED',
        duration: 1_000,
        scopeId: null,
      }),
    );
    workflows.getRunConfig = vi.fn().mockImplementation((runId: string) =>
      Promise.resolve({
        runId,
        workflowId: WORKFLOW_ID,
        workflowVersionId:
          runId === sourceRunId ? '77777777-7777-4777-8777-777777777777' : candidateVersionId,
        workflowVersion: runId === sourceRunId ? 1 : 2,
        inputs: { target: 'example.com' },
      }),
    );
    workflows.getWorkflowVersion.mockResolvedValue({
      id: candidateVersionId,
      graph: {
        successCriteria: [
          {
            id: 'report',
            title: 'Produces an investigation report',
            kind: 'output_assertion',
            nodeRef: 'agent',
            path: '/report',
            operator: 'not_empty',
          },
        ],
      },
    });
    workflows.getRunResult = vi.fn().mockImplementation((runId: string) =>
      Promise.resolve({
        success: true,
        outputs: { agent: { report: runId === sourceRunId ? '' : 'actionable report' } },
      }),
    );

    const response = await service.execute({
      commandName: 'compare_runs',
      arguments: { sourceRunId, candidateRunId },
      auth,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      turnCreatedAt: '2026-08-02T10:00:00.000Z',
      actionId: ACTION_ID,
      actionRequestedAt: '2026-08-02T10:01:00.000Z',
    });

    expect(response.result).toEqual(
      expect.objectContaining({
        assessment: 'improved',
        successCriteria: {
          benchmarkVersionId: candidateVersionId,
          criteria: [
            expect.objectContaining({
              assessment: 'improved',
              source: expect.objectContaining({ outcome: 'failed' }),
              candidate: expect.objectContaining({ outcome: 'passed' }),
            }),
          ],
        },
      }),
    );
    expect(workflows.getWorkflowVersion).toHaveBeenCalledWith(
      WORKFLOW_ID,
      candidateVersionId,
      auth,
    );
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
