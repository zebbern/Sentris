import { describe, expect, it } from 'bun:test';

import {
  OPERATOR_COMMAND_DEFINITIONS,
  OperatorGetFindingInputSchema,
  OperatorGetWorkflowInputSchema,
  OperatorRunWorkflowInputSchema,
  OperatorGetMcpPromptInputSchema,
  OperatorInvokeMcpToolInputSchema,
  OperatorListFindingsInputSchema,
  OperatorPersistedTurnPayloadSchema,
  OperatorReadMcpResourceInputSchema,
  OperatorStoredTurnContextSchema,
  OperatorCreateTurnSchema,
  OperatorUpdateFindingTriageInputSchema,
  OperatorProposeWorkflowDraftInputSchema,
  OperatorWorkflowApplyResultSchema,
  OperatorWorkflowDraftResultSchema,
} from '../operator.js';

describe('Operator run controls', () => {
  it('can inspect the exact workflow version before launching it', () => {
    expect(
      OperatorGetWorkflowInputSchema.parse({
        workflowId: '22222222-2222-4222-8222-222222222222',
        version: 4,
      }),
    ).toEqual({
      workflowId: '22222222-2222-4222-8222-222222222222',
      version: 4,
    });
    expect(
      OperatorRunWorkflowInputSchema.safeParse({
        workflowId: '22222222-2222-4222-8222-222222222222',
        inputs: {},
      }).success,
    ).toBe(false);
    expect(
      OperatorRunWorkflowInputSchema.parse({
        workflowId: '22222222-2222-4222-8222-222222222222',
        versionId: '33333333-3333-4333-8333-333333333333',
        inputs: { packageSpec: 'minimist@1.2.8' },
      }),
    ).toEqual({
      workflowId: '22222222-2222-4222-8222-222222222222',
      versionId: '33333333-3333-4333-8333-333333333333',
      inputs: { packageSpec: 'minimist@1.2.8' },
    });
  });

  it('keeps retry explicit and accepts only bounded direct run commands', () => {
    expect(OPERATOR_COMMAND_DEFINITIONS.retry_run.effect).toBe('execute');
    expect(
      OperatorCreateTurnSchema.parse({
        clientTurnId: '11111111-1111-4111-8111-111111111111',
        message: 'Retry this run',
        directCommand: {
          commandName: 'retry_run',
          arguments: { runId: 'sentris-run-1' },
        },
      }).directCommand,
    ).toEqual({ commandName: 'retry_run', arguments: { runId: 'sentris-run-1' } });
    expect(
      OperatorCreateTurnSchema.safeParse({
        clientTurnId: '11111111-1111-4111-8111-111111111111',
        message: 'Run something else',
        directCommand: {
          commandName: 'run_workflow',
          arguments: { workflowId: '22222222-2222-4222-8222-222222222222' },
        },
      }).success,
    ).toBe(false);
  });

  it('defines one strict versioned payload while accepting legacy route-only storage', () => {
    const routeContext = {
      path: '/workflows/22222222-2222-4222-8222-222222222222',
      workflowId: '22222222-2222-4222-8222-222222222222',
    };
    const payload = {
      version: 1 as const,
      routeContext,
      directCommand: {
        commandName: 'get_run' as const,
        arguments: { runId: 'sentris-run-1' },
      },
    };

    expect(OperatorPersistedTurnPayloadSchema.parse(payload)).toEqual(payload);
    expect(OperatorStoredTurnContextSchema.parse(routeContext)).toEqual(routeContext);
    expect(OperatorStoredTurnContextSchema.parse(null)).toBeNull();
    expect(OperatorPersistedTurnPayloadSchema.safeParse({ ...payload, version: 2 }).success).toBe(
      false,
    );
    expect(
      OperatorPersistedTurnPayloadSchema.safeParse({ ...payload, unexpected: true }).success,
    ).toBe(false);
  });
});

describe('Operator workflow authoring commands', () => {
  const graph = {
    name: 'Package review',
    nodes: [
      {
        id: 'entry',
        type: 'core.workflow.entrypoint',
        position: { x: 0, y: 0 },
        data: { label: 'Entry Point', config: { params: {}, inputOverrides: {} } },
      },
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };

  it('keeps proposal automatic and applying a saved version consequential', () => {
    expect(OPERATOR_COMMAND_DEFINITIONS.list_components.effect).toBe('read');
    expect(OPERATOR_COMMAND_DEFINITIONS.get_component.effect).toBe('read');
    expect(OPERATOR_COMMAND_DEFINITIONS.propose_workflow_draft.effect).toBe('execute');
    expect(OPERATOR_COMMAND_DEFINITIONS.apply_workflow_draft.effect).toBe('consequential');
  });

  it('requires update proposals to pin both workflow and immutable base version', () => {
    expect(OperatorProposeWorkflowDraftInputSchema.parse({ graph })).toEqual({ graph });
    expect(
      OperatorProposeWorkflowDraftInputSchema.safeParse({
        workflowId: '22222222-2222-4222-8222-222222222222',
        graph,
      }).success,
    ).toBe(false);
    expect(
      OperatorProposeWorkflowDraftInputSchema.safeParse({
        workflowId: '22222222-2222-4222-8222-222222222222',
        baseVersionId: '33333333-3333-4333-8333-333333333333',
        graph,
      }).success,
    ).toBe(true);
  });

  it('keeps compact draft and apply results typed for durable UI rendering', () => {
    const draftId = '44444444-4444-4444-8444-444444444444';
    expect(
      OperatorWorkflowDraftResultSchema.parse({
        kind: 'workflow-draft',
        draftId,
        mode: 'create',
        workflowId: null,
        baseVersionId: null,
        name: graph.name,
        digest: 'sha256',
        validation: { valid: true, errors: [] },
        diff: {
          metadataChanged: ['name'],
          addedNodeIds: ['entry'],
          removedNodeIds: [],
          changedNodeIds: [],
          addedEdgeIds: [],
          removedEdgeIds: [],
          changedEdgeIds: [],
        },
      }).draftId,
    ).toBe(draftId);
    expect(
      OperatorWorkflowApplyResultSchema.parse({
        kind: 'workflow-applied',
        draftId,
        workflowId: '55555555-5555-4555-8555-555555555555',
        versionId: '66666666-6666-4666-8666-666666666666',
        version: 1,
        created: true,
        name: graph.name,
      }).created,
    ).toBe(true);
  });

  it('accepts an explicit save button as a direct user-confirmed command', () => {
    expect(
      OperatorCreateTurnSchema.parse({
        clientTurnId: '11111111-1111-4111-8111-111111111111',
        message: 'Save this workflow draft',
        directCommand: {
          commandName: 'apply_workflow_draft',
          arguments: { draftId: '44444444-4444-4444-8444-444444444444' },
        },
      }).directCommand,
    ).toEqual({
      commandName: 'apply_workflow_draft',
      arguments: { draftId: '44444444-4444-4444-8444-444444444444' },
    });
  });
});

describe('Operator finding commands', () => {
  it('defaults and bounds finding-list inputs', () => {
    expect(OperatorListFindingsInputSchema.parse({})).toEqual({ limit: 20 });
    expect(
      OperatorListFindingsInputSchema.parse({
        severity: 'critical',
        triageStatus: 'new',
        limit: 50,
      }),
    ).toEqual({ severity: 'critical', triageStatus: 'new', limit: 50 });
    expect(OperatorListFindingsInputSchema.safeParse({ limit: 51 }).success).toBe(false);
    expect(OperatorListFindingsInputSchema.safeParse({ unexpected: true }).success).toBe(false);
  });

  it('requires a bounded finding identity and at least one real triage change', () => {
    expect(OperatorGetFindingInputSchema.safeParse({ findingId: '' }).success).toBe(false);
    expect(
      OperatorUpdateFindingTriageInputSchema.safeParse({ findingId: 'finding-1' }).success,
    ).toBe(false);
    expect(
      OperatorUpdateFindingTriageInputSchema.parse({
        findingId: 'finding-1',
        status: 'triaged',
        comment: 'Reviewed by the user',
      }),
    ).toEqual({ findingId: 'finding-1', status: 'triaged', comment: 'Reviewed by the user' });
  });

  it('keeps explicit triage immediate while reads remain side-effect free', () => {
    expect(OPERATOR_COMMAND_DEFINITIONS.list_findings.effect).toBe('read');
    expect(OPERATOR_COMMAND_DEFINITIONS.get_finding.effect).toBe('read');
    expect(OPERATOR_COMMAND_DEFINITIONS.update_finding_triage.effect).toBe('execute');
  });
});

describe('Operator MCP commands', () => {
  const capabilitySnapshotId = '11111111-1111-4111-8111-111111111111';

  it('keeps discovery and content reads immediate while tool calls remain consequential', () => {
    expect(OPERATOR_COMMAND_DEFINITIONS.list_mcp_servers.effect).toBe('read');
    expect(OPERATOR_COMMAND_DEFINITIONS.list_mcp_capabilities.effect).toBe('read');
    expect(OPERATOR_COMMAND_DEFINITIONS.read_mcp_resource.effect).toBe('read');
    expect(OPERATOR_COMMAND_DEFINITIONS.get_mcp_prompt.effect).toBe('read');
    expect(OPERATOR_COMMAND_DEFINITIONS.invoke_mcp_tool.effect).toBe('consequential');
  });

  it('preserves immutable snapshot, source, and operation identities', () => {
    expect(
      OperatorInvokeMcpToolInputSchema.parse({
        capabilitySnapshotId,
        sourceId: 'saved-server-1',
        name: 'search',
        arguments: { query: 'package' },
      }),
    ).toEqual({
      capabilitySnapshotId,
      sourceId: 'saved-server-1',
      name: 'search',
      arguments: { query: 'package' },
    });
    expect(
      OperatorReadMcpResourceInputSchema.parse({
        capabilitySnapshotId,
        sourceId: 'saved-server-1',
        uri: 'repo://src/index.ts',
        templateUri: 'repo://{path}',
      }),
    ).toEqual({
      capabilitySnapshotId,
      sourceId: 'saved-server-1',
      uri: 'repo://src/index.ts',
      templateUri: 'repo://{path}',
    });
    expect(
      OperatorGetMcpPromptInputSchema.safeParse({
        capabilitySnapshotId,
        sourceId: 'saved-server-1',
        name: 'review',
        arguments: { depth: 2 },
      }).success,
    ).toBe(false);
  });
});
