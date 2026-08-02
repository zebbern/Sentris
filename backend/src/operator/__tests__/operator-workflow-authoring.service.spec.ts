import { beforeEach, describe, expect, it, vi } from 'bun:test';

import type { WorkflowGraph } from '@sentris/shared';

import type { AuthContext } from '../../auth/types';
import type { WorkflowVersionRepository } from '../../workflows/repository/workflow-version.repository';
import type { WorkflowsService } from '../../workflows/workflows.service';
import type { OperatorRepository } from '../operator.repository';
import {
  OPERATOR_PRESERVE_CREDENTIAL,
  OperatorWorkflowAuthoringService,
} from '../operator-workflow-authoring.service';

const ORGANIZATION_ID = 'operator-org';
const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_SESSION_ID = '22222222-2222-4222-8222-222222222222';
const TURN_ID = '33333333-3333-4333-8333-333333333333';
const PROPOSAL_ACTION_ID = '44444444-4444-4444-8444-444444444444';
const WORKFLOW_ID = '55555555-5555-4555-8555-555555555555';
const BASE_VERSION_ID = '66666666-6666-4666-8666-666666666666';
const SAVED_VERSION_ID = '77777777-7777-4777-8777-777777777777';
const SOURCE_RUN_ID = 'sentris-run-source';
const INLINE_API_KEY = 'sk-inline-value-that-must-never-reach-the-model';

const auth: AuthContext = {
  userId: 'operator-user',
  organizationId: ORGANIZATION_ID,
  roles: ['ADMIN'],
  isAuthenticated: true,
  provider: 'operator',
};

function makeGraph(
  input: {
    name?: string;
    label?: string;
    componentType?: string;
  } = {},
): WorkflowGraph {
  return {
    name: input.name ?? 'Operator workflow',
    description: 'Created through a durable Operator proposal',
    nodes: [
      {
        id: 'trigger',
        type: input.componentType ?? 'core.workflow.entrypoint',
        position: { x: 0, y: 0 },
        data: {
          label: input.label ?? 'Start',
          config: {
            params: {
              runtimeInputs: [],
            },
            inputOverrides: {},
          },
        },
      },
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

function makeHttpRequestNode(input: {
  id: string;
  credential?: string;
  authType?: 'none' | 'custom';
}): WorkflowGraph['nodes'][number] {
  return {
    id: input.id,
    type: 'core.http.request',
    position: { x: 100, y: 0 },
    data: {
      label: `Request ${input.id}`,
      config: {
        params: { method: 'GET', authType: input.authType ?? 'custom' },
        inputOverrides: {
          url: `https://${input.id}.example.test`,
          ...((input.authType ?? 'custom') === 'custom' ? { authHeaderName: 'Authorization' } : {}),
          ...(input.credential === undefined ? {} : { authHeaderValue: input.credential }),
        },
      },
    },
  };
}

function makeCredentialGraph(
  input: {
    name?: string;
    credential?: string;
    authType?: 'none' | 'custom';
  } = {},
): WorkflowGraph {
  return {
    name: input.name ?? 'Operator workflow',
    description: 'Created through a durable Operator proposal',
    nodes: [
      makeGraph().nodes[0]!,
      makeHttpRequestNode({
        id: 'request',
        credential: input.credential,
        authType: input.authType,
      }),
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

function makeAgentGraph(apiKey: string): WorkflowGraph {
  return {
    ...makeGraph(),
    nodes: [
      makeGraph().nodes[0]!,
      {
        id: 'agent',
        type: 'core.ai.agent',
        position: { x: 100, y: 0 },
        data: {
          label: 'Investigate',
          config: {
            params: {},
            inputOverrides: {
              userInput: 'Investigate the target',
              chatModel: {
                provider: 'gemini',
                modelId: 'gemini-2.5-flash',
                apiKey,
              },
            },
          },
        },
      },
    ],
  };
}

function readCredential(graph: WorkflowGraph, nodeId = 'request'): unknown {
  return graph.nodes.find((node) => node.id === nodeId)?.data.config.inputOverrides.authHeaderValue;
}

function versionRecord(graph: WorkflowGraph) {
  return {
    id: BASE_VERSION_ID,
    workflowId: WORKFLOW_ID,
    version: 3,
    graph,
    organizationId: ORGANIZATION_ID,
    compiledDefinition: null,
    createdAt: new Date('2026-08-02T10:00:00.000Z'),
  };
}

function proposalResult(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'workflow-draft' as const,
    draftId: PROPOSAL_ACTION_ID,
    mode: 'update' as const,
    workflowId: WORKFLOW_ID,
    baseVersionId: BASE_VERSION_ID,
    name: 'Updated workflow',
    digest: 'proposal-digest',
    validation: { valid: true, errors: [] },
    diff: {
      metadataChanged: ['name'],
      addedNodeIds: [],
      removedNodeIds: [],
      changedNodeIds: ['trigger'],
      addedEdgeIds: [],
      removedEdgeIds: [],
      changedEdgeIds: [],
    },
    ...overrides,
  };
}

function proposalContext(input: {
  graph: WorkflowGraph;
  sessionId?: string;
  create?: boolean;
  sourceRunId?: string;
}) {
  const create = input.create ?? false;
  return {
    action: {
      id: PROPOSAL_ACTION_ID,
      sessionId: input.sessionId ?? SESSION_ID,
      turnId: TURN_ID,
      commandName: 'propose_workflow_draft',
      status: 'succeeded',
      arguments: {
        graph: input.graph,
        summary: create ? 'Create a workflow' : 'Update the workflow',
        ...(create ? {} : { workflowId: WORKFLOW_ID, baseVersionId: BASE_VERSION_ID }),
        ...(input.sourceRunId ? { sourceRunId: input.sourceRunId } : {}),
      },
      result: proposalResult(
        create
          ? {
              mode: 'create',
              workflowId: null,
              baseVersionId: null,
              diff: {
                ...proposalResult().diff,
                metadataChanged: ['name', 'description'],
                addedNodeIds: ['trigger'],
                changedNodeIds: [],
              },
            }
          : input.sourceRunId
            ? { sourceRunId: input.sourceRunId }
            : {},
      ),
    },
    turn: { id: TURN_ID, sessionId: input.sessionId ?? SESSION_ID },
    session: { id: input.sessionId ?? SESSION_ID, organizationId: ORGANIZATION_ID },
  };
}

function editProposalContext(input: {
  operations: Record<string, unknown>[];
  sourceRunId?: string;
}) {
  return {
    action: {
      id: PROPOSAL_ACTION_ID,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      commandName: 'propose_workflow_edits',
      status: 'succeeded',
      arguments: {
        workflowId: WORKFLOW_ID,
        baseVersionId: BASE_VERSION_ID,
        operations: input.operations,
        ...(input.sourceRunId ? { sourceRunId: input.sourceRunId } : {}),
      },
      result: proposalResult(input.sourceRunId ? { sourceRunId: input.sourceRunId } : undefined),
    },
    turn: { id: TURN_ID, sessionId: SESSION_ID },
    session: { id: SESSION_ID, organizationId: ORGANIZATION_ID },
  };
}

describe('OperatorWorkflowAuthoringService', () => {
  let workflows: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    getRun: ReturnType<typeof vi.fn>;
  };
  let versions: {
    findById: ReturnType<typeof vi.fn>;
    findByIds: ReturnType<typeof vi.fn>;
  };
  let operatorRepository: {
    getActionWithTurnSession: ReturnType<typeof vi.fn>;
  };
  let service: OperatorWorkflowAuthoringService;

  beforeEach(() => {
    workflows = {
      create: vi.fn(),
      update: vi.fn(),
      getRun: vi.fn(),
    };
    versions = {
      findById: vi.fn(),
      findByIds: vi.fn(),
    };
    operatorRepository = {
      getActionWithTurnSession: vi.fn(),
    };
    service = new OperatorWorkflowAuthoringService(
      workflows as unknown as WorkflowsService,
      versions as unknown as WorkflowVersionRepository,
      operatorRepository as unknown as OperatorRepository,
    );
  });

  it('returns a compact validated proposal and an exact graph diff', async () => {
    const baseGraph = makeCredentialGraph({
      name: 'Base workflow',
      credential: INLINE_API_KEY,
    });
    const projected = service.projectGraph(baseGraph);
    const proposedGraph: WorkflowGraph = {
      ...projected,
      name: 'Updated workflow',
      nodes: projected.nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          label: node.id === 'request' ? 'Updated request' : node.data.label,
        },
      })),
    };
    versions.findById.mockResolvedValue(versionRecord(baseGraph));

    const result = await service.propose({
      arguments: {
        workflowId: WORKFLOW_ID,
        baseVersionId: BASE_VERSION_ID,
        summary: 'Rename the workflow and its entry node',
        graph: proposedGraph,
      },
      auth,
      actionId: PROPOSAL_ACTION_ID,
    });

    expect(result).toMatchObject({
      kind: 'workflow-draft',
      draftId: PROPOSAL_ACTION_ID,
      mode: 'update',
      workflowId: WORKFLOW_ID,
      baseVersionId: BASE_VERSION_ID,
      name: 'Updated workflow',
      validation: { valid: true, errors: [] },
      diff: {
        metadataChanged: ['name'],
        addedNodeIds: [],
        removedNodeIds: [],
        changedNodeIds: ['request'],
        addedEdgeIds: [],
        removedEdgeIds: [],
        changedEdgeIds: [],
      },
    });
    expect(result).not.toHaveProperty('graph');
    expect(JSON.stringify(result)).not.toContain(INLINE_API_KEY);
  });

  it('materializes compact ID-based edits against the exact credential-safe base graph', async () => {
    const baseGraph = makeCredentialGraph({
      name: 'Base workflow',
      credential: INLINE_API_KEY,
    });
    versions.findById.mockResolvedValue(versionRecord(baseGraph));

    const result = await service.proposeEdits({
      arguments: {
        workflowId: WORKFLOW_ID,
        baseVersionId: BASE_VERSION_ID,
        summary: 'Use POST and clarify the request node',
        operations: [
          { operation: 'set_workflow_metadata', name: 'Updated workflow' },
          {
            operation: 'patch_node',
            nodeId: 'request',
            label: 'Updated request',
            setParameters: { method: 'POST' },
          },
        ],
      },
      auth,
      actionId: PROPOSAL_ACTION_ID,
    });

    expect(result).toMatchObject({
      kind: 'workflow-draft',
      mode: 'update',
      workflowId: WORKFLOW_ID,
      baseVersionId: BASE_VERSION_ID,
      name: 'Updated workflow',
      validation: { valid: true, errors: [] },
      diff: {
        metadataChanged: ['name'],
        changedNodeIds: ['request'],
      },
    });
    expect(JSON.stringify(result)).not.toContain(INLINE_API_KEY);
  });

  it('returns invalid compact edits for missing IDs and no-op proposals without changing the base', async () => {
    const baseGraph = makeGraph({ name: 'Base workflow' });
    versions.findById.mockResolvedValue(versionRecord(baseGraph));

    const result = await service.proposeEdits({
      arguments: {
        workflowId: WORKFLOW_ID,
        baseVersionId: BASE_VERSION_ID,
        operations: [
          {
            operation: 'patch_node',
            nodeId: 'missing-node',
            setParameters: { modelId: 'gemini-2.5-pro' },
          },
        ],
      },
      auth,
      actionId: PROPOSAL_ACTION_ID,
    });

    expect(result.validation.valid).toBe(false);
    expect(result.validation.errors).toEqual([
      expect.stringContaining('operations.0: node missing-node does not exist'),
      expect.stringContaining('does not change the workflow'),
    ]);
    expect(result.diff).toEqual({
      metadataChanged: [],
      addedNodeIds: [],
      removedNodeIds: [],
      changedNodeIds: [],
      addedEdgeIds: [],
      removedEdgeIds: [],
      changedEdgeIds: [],
    });
  });

  it('validates and preserves terminal source-run lineage on an update proposal', async () => {
    const baseGraph = makeGraph({ name: 'Base workflow' });
    versions.findById.mockResolvedValue(versionRecord(baseGraph));
    workflows.getRun.mockResolvedValue({
      id: SOURCE_RUN_ID,
      workflowId: WORKFLOW_ID,
      status: 'FAILED',
    });

    const result = await service.propose({
      arguments: {
        workflowId: WORKFLOW_ID,
        baseVersionId: BASE_VERSION_ID,
        sourceRunId: SOURCE_RUN_ID,
        graph: { ...baseGraph, name: 'Improved workflow' },
      },
      auth,
      actionId: PROPOSAL_ACTION_ID,
    });

    expect(workflows.getRun).toHaveBeenCalledWith(SOURCE_RUN_ID, auth);
    expect(result.sourceRunId).toBe(SOURCE_RUN_ID);
  });

  it('rejects source-run lineage from another workflow or an active run', async () => {
    versions.findById.mockResolvedValue(versionRecord(makeGraph()));
    workflows.getRun.mockResolvedValueOnce({
      id: SOURCE_RUN_ID,
      workflowId: '99999999-9999-4999-8999-999999999999',
      status: 'FAILED',
    });
    const argumentsWithSource = {
      workflowId: WORKFLOW_ID,
      baseVersionId: BASE_VERSION_ID,
      sourceRunId: SOURCE_RUN_ID,
      graph: makeGraph(),
    };

    await expect(
      service.propose({ arguments: argumentsWithSource, auth, actionId: PROPOSAL_ACTION_ID }),
    ).rejects.toThrow('does not belong to workflow');

    workflows.getRun.mockResolvedValueOnce({
      id: SOURCE_RUN_ID,
      workflowId: WORKFLOW_ID,
      status: 'RUNNING',
    });
    await expect(
      service.propose({ arguments: argumentsWithSource, auth, actionId: PROPOSAL_ACTION_ID }),
    ).rejects.toThrow('is still RUNNING');
  });

  it('returns compile failures as validation errors instead of throwing away the proposal', async () => {
    const result = await service.propose({
      arguments: {
        summary: 'Draft with an unavailable component',
        graph: makeGraph({ componentType: 'missing.operator.component' }),
      },
      auth,
      actionId: PROPOSAL_ACTION_ID,
    });

    expect(result.validation.valid).toBe(false);
    expect(result.validation.errors).toEqual([
      expect.stringContaining('Component not registered: missing.operator.component'),
    ]);
    expect(result.diff.addedNodeIds).toEqual(['trigger']);
  });

  it('formats compiler schema issues as actionable paths instead of JSON fragments', async () => {
    const invalidGraph = makeGraph();
    invalidGraph.nodes[0]!.data.config.params.runtimeInputs = [
      { id: 'target', label: 'Target URL', type: 'url', required: true },
    ];

    const result = await service.propose({
      arguments: { graph: invalidGraph },
      auth,
      actionId: PROPOSAL_ACTION_ID,
    });

    expect(result.validation.valid).toBe(false);
    expect(result.validation.errors[0]).toContain('type');
    expect(result.validation.errors[0]).toContain('Invalid option');
    expect(result.validation.errors).not.toContain('[');
  });

  it('projects inline credentials to an opaque placeholder', () => {
    const projected = service.projectGraph(makeCredentialGraph({ credential: INLINE_API_KEY }));

    expect(readCredential(projected)).toBe(OPERATOR_PRESERVE_CREDENTIAL);
    expect(JSON.stringify(projected)).not.toContain(INLINE_API_KEY);
  });

  it('omits a stale credential placeholder that is no longer currently declared secret', () => {
    const graph = makeCredentialGraph({
      authType: 'none',
      credential: OPERATOR_PRESERVE_CREDENTIAL,
    });

    const projected = service.projectGraph(graph);

    expect(
      projected.nodes.find((node) => node.id === 'request')?.data.config.inputOverrides,
    ).not.toHaveProperty('authHeaderValue');
    expect(JSON.stringify(projected)).not.toContain(OPERATOR_PRESERVE_CREDENTIAL);
  });

  it('re-sanitizes persisted proposal arguments before returning draft details', async () => {
    const graph = makeCredentialGraph({ credential: INLINE_API_KEY });
    versions.findByIds.mockResolvedValue([]);

    const [detail] = await service.listDraftDetails(
      [proposalContext({ graph, create: true }).action] as never,
      auth,
    );

    expect(readCredential(detail!.proposedGraph)).toBe(OPERATOR_PRESERVE_CREDENTIAL);
    expect(JSON.stringify(detail)).not.toContain(INLINE_API_KEY);
  });

  it('returns the materialized credential-safe graph for compact edit draft previews', async () => {
    const baseGraph = makeCredentialGraph({
      name: 'Base workflow',
      credential: INLINE_API_KEY,
    });
    versions.findByIds.mockResolvedValue([versionRecord(baseGraph)]);
    const context = editProposalContext({
      operations: [
        { operation: 'set_workflow_metadata', name: 'Updated workflow' },
        {
          operation: 'patch_node',
          nodeId: 'request',
          setParameters: { method: 'POST' },
        },
      ],
    });

    const [detail] = await service.listDraftDetails([context.action] as never, auth);

    expect(detail!.proposedGraph.name).toBe('Updated workflow');
    expect(
      detail!.proposedGraph.nodes.find((node) => node.id === 'request')?.data.config.params.method,
    ).toBe('POST');
    expect(readCredential(detail!.proposedGraph)).toBe(OPERATOR_PRESERVE_CREDENTIAL);
    expect(JSON.stringify(detail)).not.toContain(INLINE_API_KEY);
  });

  it('uses base secret metadata when redacting an invalid draft preview', async () => {
    const rejectedValue = 'rejected-former-secret';
    const baseGraph = makeCredentialGraph({ credential: INLINE_API_KEY });
    const proposedGraph = service.projectGraph(baseGraph);
    const proposedRequest = proposedGraph.nodes.find((node) => node.id === 'request')!;
    proposedRequest.data.config.params.authType = 'none';
    proposedRequest.data.config.inputOverrides.authHeaderValue = rejectedValue;
    versions.findByIds.mockResolvedValue([versionRecord(baseGraph)]);

    const [detail] = await service.listDraftDetails(
      [proposalContext({ graph: proposedGraph }).action] as never,
      auth,
    );

    expect(
      detail!.proposedGraph.nodes.find((node) => node.id === 'request')?.data.config.inputOverrides,
    ).not.toHaveProperty('authHeaderValue');
    expect(JSON.stringify(detail)).not.toContain(rejectedValue);
    expect(JSON.stringify(detail)).not.toContain(INLINE_API_KEY);
  });

  it('retains omitted declared secret fields as placeholders in update draft details', async () => {
    const baseGraph: WorkflowGraph = {
      ...makeGraph({ name: 'Base workflow' }),
      nodes: [
        {
          id: 'request',
          type: 'core.http.request',
          position: { x: 100, y: 0 },
          data: {
            label: 'Authenticated request',
            config: {
              params: { method: 'GET', authType: 'custom' },
              inputOverrides: { authHeaderValue: INLINE_API_KEY },
            },
          },
        },
      ],
    };
    const proposedGraph: WorkflowGraph = {
      ...baseGraph,
      name: 'Updated workflow',
      nodes: baseGraph.nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          config: { ...node.data.config, inputOverrides: {} },
        },
      })),
    };
    versions.findByIds.mockResolvedValue([versionRecord(baseGraph)]);

    const [detail] = await service.listDraftDetails(
      [proposalContext({ graph: proposedGraph }).action] as never,
      auth,
    );

    expect(detail!.proposedGraph.nodes[0]?.data.config.inputOverrides.authHeaderValue).toBe(
      OPERATOR_PRESERVE_CREDENTIAL,
    );
    expect(JSON.stringify(detail)).not.toContain(INLINE_API_KEY);
  });

  it('restores the base credential and applies an update with the proposal idempotency fence', async () => {
    const baseGraph = makeCredentialGraph({
      name: 'Base workflow',
      credential: INLINE_API_KEY,
    });
    const proposedGraph = {
      ...service.projectGraph(baseGraph),
      name: 'Updated workflow',
    };
    operatorRepository.getActionWithTurnSession.mockResolvedValue(
      proposalContext({ graph: proposedGraph, sourceRunId: SOURCE_RUN_ID }),
    );
    versions.findById.mockResolvedValue(versionRecord(baseGraph));
    workflows.update.mockResolvedValue({
      id: WORKFLOW_ID,
      name: 'Updated workflow',
      currentVersionId: SAVED_VERSION_ID,
      currentVersion: 4,
    });

    const result = await service.apply({
      arguments: { draftId: PROPOSAL_ACTION_ID },
      auth,
      sessionId: SESSION_ID,
    });

    expect(workflows.update).toHaveBeenCalledTimes(1);
    const [workflowId, effectiveGraph, actor, options] = workflows.update.mock.calls[0]!;
    expect(workflowId).toBe(WORKFLOW_ID);
    expect(readCredential(effectiveGraph as WorkflowGraph)).toBe(INLINE_API_KEY);
    expect(actor).toEqual(auth);
    expect(options).toEqual({
      expectedVersionId: BASE_VERSION_ID,
      idempotencyKey: `operator-draft:${PROPOSAL_ACTION_ID}`,
    });
    expect(result).toEqual({
      kind: 'workflow-applied',
      draftId: PROPOSAL_ACTION_ID,
      workflowId: WORKFLOW_ID,
      versionId: SAVED_VERSION_ID,
      version: 4,
      created: false,
      name: 'Updated workflow',
      sourceRunId: SOURCE_RUN_ID,
    });
  });

  it('re-materializes and applies a compact edit proposal through the same version fence', async () => {
    const baseGraph = makeCredentialGraph({
      name: 'Base workflow',
      credential: INLINE_API_KEY,
    });
    operatorRepository.getActionWithTurnSession.mockResolvedValue(
      editProposalContext({
        sourceRunId: SOURCE_RUN_ID,
        operations: [
          { operation: 'set_workflow_metadata', name: 'Updated workflow' },
          {
            operation: 'patch_node',
            nodeId: 'request',
            setParameters: { method: 'POST' },
          },
        ],
      }),
    );
    versions.findById.mockResolvedValue(versionRecord(baseGraph));
    workflows.update.mockResolvedValue({
      id: WORKFLOW_ID,
      name: 'Updated workflow',
      currentVersionId: SAVED_VERSION_ID,
      currentVersion: 4,
    });

    const result = await service.apply({
      arguments: { draftId: PROPOSAL_ACTION_ID },
      auth,
      sessionId: SESSION_ID,
    });

    const [workflowId, effectiveGraph, actor, options] = workflows.update.mock.calls[0]!;
    expect(workflowId).toBe(WORKFLOW_ID);
    expect(readCredential(effectiveGraph as WorkflowGraph)).toBe(INLINE_API_KEY);
    expect(
      (effectiveGraph as WorkflowGraph).nodes.find((node) => node.id === 'request')?.data.config
        .params.method,
    ).toBe('POST');
    expect(actor).toEqual(auth);
    expect(options).toEqual({
      expectedVersionId: BASE_VERSION_ID,
      idempotencyKey: `operator-draft:${PROPOSAL_ACTION_ID}`,
    });
    expect(result.sourceRunId).toBe(SOURCE_RUN_ID);
  });

  it('deep-merges compact structured edits so omitted nested credentials remain unchanged', async () => {
    const nestedApiKey = 'nested-chat-model-secret';
    const baseGraph = makeAgentGraph(nestedApiKey);
    const operations = [
      {
        operation: 'patch_node',
        nodeId: 'agent',
        setInputOverrides: {
          chatModel: { provider: 'gemini', modelId: 'gemini-3.6-flash' },
        },
      },
    ];
    operatorRepository.getActionWithTurnSession.mockResolvedValue(
      editProposalContext({ operations }),
    );
    versions.findById.mockResolvedValue(versionRecord(baseGraph));
    workflows.update.mockResolvedValue({
      id: WORKFLOW_ID,
      name: baseGraph.name,
      currentVersionId: SAVED_VERSION_ID,
      currentVersion: 4,
    });

    await service.apply({
      arguments: { draftId: PROPOSAL_ACTION_ID },
      auth,
      sessionId: SESSION_ID,
    });

    const effectiveGraph = workflows.update.mock.calls[0]![1] as WorkflowGraph;
    const effectiveModel = effectiveGraph.nodes.find((node) => node.id === 'agent')?.data.config
      .inputOverrides.chatModel as Record<string, unknown>;
    expect(effectiveModel).toEqual({
      provider: 'gemini',
      modelId: 'gemini-3.6-flash',
      apiKey: nestedApiKey,
    });
  });

  it('restores credentials by node id when same-type nodes are reordered', async () => {
    const firstCredential = 'first-node-secret';
    const secondCredential = 'second-node-secret';
    const baseGraph: WorkflowGraph = {
      ...makeCredentialGraph({ name: 'Base workflow' }),
      nodes: [
        makeGraph().nodes[0]!,
        makeHttpRequestNode({ id: 'first', credential: firstCredential }),
        makeHttpRequestNode({ id: 'second', credential: secondCredential }),
      ],
    };
    const projected = service.projectGraph(baseGraph);
    const proposedGraph: WorkflowGraph = {
      ...projected,
      name: 'Reordered workflow',
      nodes: [projected.nodes[0]!, projected.nodes[2]!, projected.nodes[1]!],
    };
    operatorRepository.getActionWithTurnSession.mockResolvedValue(
      proposalContext({ graph: proposedGraph }),
    );
    versions.findById.mockResolvedValue(versionRecord(baseGraph));
    workflows.update.mockResolvedValue({
      id: WORKFLOW_ID,
      name: 'Reordered workflow',
      currentVersionId: SAVED_VERSION_ID,
      currentVersion: 4,
    });

    await service.apply({
      arguments: { draftId: PROPOSAL_ACTION_ID },
      auth,
      sessionId: SESSION_ID,
    });

    const effectiveGraph = workflows.update.mock.calls[0]![1] as WorkflowGraph;
    expect(readCredential(effectiveGraph, 'first')).toBe(firstCredential);
    expect(readCredential(effectiveGraph, 'second')).toBe(secondCredential);
  });

  it('projects and restores an explicit nested generic credential at the exact base path', async () => {
    const nestedApiKey = 'nested-chat-model-secret';
    const baseGraph = makeAgentGraph(nestedApiKey);
    const proposedGraph = service.projectGraph(baseGraph);
    const proposedModel = proposedGraph.nodes.find((node) => node.id === 'agent')?.data.config
      .inputOverrides.chatModel as Record<string, unknown>;
    expect(proposedModel.apiKey).toBe(OPERATOR_PRESERVE_CREDENTIAL);
    expect(JSON.stringify(proposedGraph)).not.toContain(nestedApiKey);
    operatorRepository.getActionWithTurnSession.mockResolvedValue(
      proposalContext({ graph: proposedGraph }),
    );
    versions.findById.mockResolvedValue(versionRecord(baseGraph));
    workflows.update.mockResolvedValue({
      id: WORKFLOW_ID,
      name: proposedGraph.name,
      currentVersionId: SAVED_VERSION_ID,
      currentVersion: 4,
    });

    await service.apply({
      arguments: { draftId: PROPOSAL_ACTION_ID },
      auth,
      sessionId: SESSION_ID,
    });

    const effectiveGraph = workflows.update.mock.calls[0]![1] as WorkflowGraph;
    const effectiveModel = effectiveGraph.nodes.find((node) => node.id === 'agent')?.data.config
      .inputOverrides.chatModel as Record<string, unknown>;
    expect(effectiveModel.apiKey).toBe(nestedApiKey);
  });

  it('does not implicitly merge an omitted nested generic credential from the base', async () => {
    const baseGraph = makeAgentGraph('nested-chat-model-secret');
    const proposedGraph = service.projectGraph(baseGraph);
    const proposedModel = proposedGraph.nodes.find((node) => node.id === 'agent')?.data.config
      .inputOverrides.chatModel as Record<string, unknown>;
    delete proposedModel.apiKey;
    operatorRepository.getActionWithTurnSession.mockResolvedValue(
      proposalContext({ graph: proposedGraph }),
    );
    versions.findById.mockResolvedValue(versionRecord(baseGraph));
    workflows.update.mockResolvedValue({
      id: WORKFLOW_ID,
      name: proposedGraph.name,
      currentVersionId: SAVED_VERSION_ID,
      currentVersion: 4,
    });

    await service.apply({
      arguments: { draftId: PROPOSAL_ACTION_ID },
      auth,
      sessionId: SESSION_ID,
    });

    const effectiveGraph = workflows.update.mock.calls[0]![1] as WorkflowGraph;
    const effectiveModel = effectiveGraph.nodes.find((node) => node.id === 'agent')?.data.config
      .inputOverrides.chatModel as Record<string, unknown>;
    expect(effectiveModel).not.toHaveProperty('apiKey');
  });

  it('does not reintroduce an omitted credential after the current schema stops declaring it secret', async () => {
    const baseGraph = makeCredentialGraph({ credential: INLINE_API_KEY });
    const proposedGraph = service.projectGraph(baseGraph);
    const proposedRequest = proposedGraph.nodes.find((node) => node.id === 'request')!;
    proposedRequest.data.config.params.authType = 'none';
    delete proposedRequest.data.config.inputOverrides.authHeaderValue;
    operatorRepository.getActionWithTurnSession.mockResolvedValue(
      proposalContext({ graph: proposedGraph }),
    );
    versions.findById.mockResolvedValue(versionRecord(baseGraph));
    workflows.update.mockResolvedValue({
      id: WORKFLOW_ID,
      name: proposedGraph.name,
      currentVersionId: SAVED_VERSION_ID,
      currentVersion: 4,
    });

    await service.apply({
      arguments: { draftId: PROPOSAL_ACTION_ID },
      auth,
      sessionId: SESSION_ID,
    });

    const effectiveGraph = workflows.update.mock.calls[0]![1] as WorkflowGraph;
    expect(
      effectiveGraph.nodes.find((node) => node.id === 'request')?.data.config.inputOverrides,
    ).not.toHaveProperty('authHeaderValue');
    expect(JSON.stringify(effectiveGraph)).not.toContain(INLINE_API_KEY);
    expect(JSON.stringify(effectiveGraph)).not.toContain(OPERATOR_PRESERVE_CREDENTIAL);
  });

  it('rejects a nonempty credential value after the current schema stops declaring it secret', async () => {
    const baseGraph = makeCredentialGraph({ credential: INLINE_API_KEY });
    const proposedGraph = service.projectGraph(baseGraph);
    const proposedRequest = proposedGraph.nodes.find((node) => node.id === 'request')!;
    proposedRequest.data.config.params.authType = 'none';
    proposedRequest.data.config.inputOverrides.authHeaderValue = 'replacement-inline-secret';
    operatorRepository.getActionWithTurnSession.mockResolvedValue(
      proposalContext({ graph: proposedGraph }),
    );
    versions.findById.mockResolvedValue(versionRecord(baseGraph));

    await expect(
      service.apply({
        arguments: { draftId: PROPOSAL_ACTION_ID },
        auth,
        sessionId: SESSION_ID,
      }),
    ).rejects.toThrow('no longer declared secret');
    expect(workflows.update).not.toHaveBeenCalled();
  });

  it('does not carry a preserved credential across a component type change', async () => {
    const baseGraph = makeCredentialGraph({ credential: INLINE_API_KEY });
    const proposedGraph = makeGraph();
    proposedGraph.nodes.push({
      id: 'request',
      type: 'core.ui.text',
      position: { x: 100, y: 0 },
      data: {
        label: 'Replacement note',
        config: {
          params: { content: 'No authentication needed' },
          inputOverrides: { authHeaderValue: OPERATOR_PRESERVE_CREDENTIAL },
        },
      },
    });
    operatorRepository.getActionWithTurnSession.mockResolvedValue(
      proposalContext({ graph: proposedGraph }),
    );
    versions.findById.mockResolvedValue(versionRecord(baseGraph));
    workflows.update.mockResolvedValue({
      id: WORKFLOW_ID,
      name: proposedGraph.name,
      currentVersionId: SAVED_VERSION_ID,
      currentVersion: 4,
    });

    await service.apply({
      arguments: { draftId: PROPOSAL_ACTION_ID },
      auth,
      sessionId: SESSION_ID,
    });

    const effectiveGraph = workflows.update.mock.calls[0]![1] as WorkflowGraph;
    expect(
      effectiveGraph.nodes.find((node) => node.id === 'request')?.data.config.inputOverrides,
    ).not.toHaveProperty('authHeaderValue');
    expect(JSON.stringify(effectiveGraph)).not.toContain(INLINE_API_KEY);
    expect(JSON.stringify(effectiveGraph)).not.toContain(OPERATOR_PRESERVE_CREDENTIAL);
  });

  it('applies a create proposal with the same stable idempotency key', async () => {
    const graph = makeGraph({ name: 'New workflow' });
    operatorRepository.getActionWithTurnSession.mockResolvedValue(
      proposalContext({ graph, create: true }),
    );
    workflows.create.mockResolvedValue({
      id: WORKFLOW_ID,
      name: 'New workflow',
      currentVersionId: SAVED_VERSION_ID,
      currentVersion: 1,
    });

    const result = await service.apply({
      arguments: { draftId: PROPOSAL_ACTION_ID },
      auth,
      sessionId: SESSION_ID,
    });

    expect(workflows.create).toHaveBeenCalledWith(graph, auth, {
      idempotencyKey: `operator-draft:${PROPOSAL_ACTION_ID}`,
    });
    expect(workflows.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({ created: true, version: 1 });
  });

  it('rejects a proposal owned by another Operator session before any workflow write', async () => {
    operatorRepository.getActionWithTurnSession.mockResolvedValue(
      proposalContext({ graph: makeGraph(), sessionId: OTHER_SESSION_ID, create: true }),
    );

    await expect(
      service.apply({
        arguments: { draftId: PROPOSAL_ACTION_ID },
        auth,
        sessionId: SESSION_ID,
      }),
    ).rejects.toThrow('Operator workflow draft not found');
    expect(workflows.create).not.toHaveBeenCalled();
    expect(workflows.update).not.toHaveBeenCalled();
  });

  it('offers bounded component discovery through the canonical registry', () => {
    const components = service.listComponents({ search: 'entry point', limit: 5 }) as {
      id: string;
      name: string;
    }[];

    expect(components).toContainEqual(
      expect.objectContaining({ id: 'core.workflow.entrypoint', name: 'Entry Point' }),
    );
    expect(service.getComponent({ componentId: 'core.workflow.entrypoint' })).toMatchObject({
      id: 'core.workflow.entrypoint',
      name: 'Entry Point',
      inputs: expect.any(Array),
      outputs: expect.any(Array),
    });
  });
});
