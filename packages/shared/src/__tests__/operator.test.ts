import { describe, expect, it } from 'bun:test';
import { z } from 'zod';

import {
  OPERATOR_WORKFLOW_EDIT_OPERATIONS,
  OPERATOR_COMMAND_DEFINITIONS,
  OperatorCompareRunsInputSchema,
  OperatorGetFindingInputSchema,
  OperatorGetRunInputSchema,
  OperatorGetWorkflowInputSchema,
  OperatorRunWorkflowInputSchema,
  OperatorRunInputChangesSchema,
  OperatorRunComparisonResultSchema,
  OperatorGetMcpPromptInputSchema,
  OperatorInvokeMcpToolInputSchema,
  OperatorListFindingsInputSchema,
  OperatorListWorkflowTemplatesResultSchema,
  OperatorPersistedTurnPayloadSchema,
  OperatorPersistedTurnPayloadV1Schema,
  OperatorActionDecisionSchema,
  OperatorProposePlanInputSchema,
  OperatorProposeRunInputChangesInputSchema,
  OperatorRequestUserInputSchema,
  resolveOperatorPlanStepArguments,
  OperatorReadMcpResourceInputSchema,
  OperatorSessionStreamErrorSchema,
  OperatorSessionStreamReadySchema,
  OperatorSessionStreamSnapshotSchema,
  OperatorStoredTurnContextSchema,
  OperatorCreateTurnSchema,
  OperatorUpdateFindingTriageInputSchema,
  OperatorProposeWorkflowEditsInputSchema,
  OperatorProposeWorkflowDraftInputSchema,
  OperatorWorkflowApplyResultSchema,
  OperatorWorkflowDraftResultSchema,
} from '../operator.js';
import { WorkflowSuccessCriteriaSchema } from '../workflow-graph.js';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';

describe('Operator user input', () => {
  it('requires an answer path and carries a bounded durable response', () => {
    expect(
      OperatorRequestUserInputSchema.parse({
        question: 'Which package should I inspect?',
        options: ['axios', 'lodash'],
        allowFreeform: true,
      }),
    ).toEqual({
      question: 'Which package should I inspect?',
      options: ['axios', 'lodash'],
      allowFreeform: true,
    });
    expect(
      OperatorRequestUserInputSchema.safeParse({
        question: 'Which package should I inspect?',
        allowFreeform: false,
      }).success,
    ).toBe(false);
    expect(
      OperatorActionDecisionSchema.parse({
        decision: 'approved',
        expectedVersion: 3,
        response: { response: 'lodash', selectedOption: 'lodash' },
      }),
    ).toEqual({
      decision: 'approved',
      expectedVersion: 3,
      response: { response: 'lodash', selectedOption: 'lodash' },
    });
  });
});

describe('Operator run controls', () => {
  it('requires an explicit set value while accepting JSON value shapes', () => {
    expect(
      OperatorRunInputChangesSchema.safeParse({
        set: [{ inputId: 'target' }],
        unset: [],
      }).success,
    ).toBe(false);
    expect(
      OperatorRunInputChangesSchema.safeParse({
        set: [{ inputId: 'target', value: undefined }],
        unset: [],
      }).success,
    ).toBe(false);

    for (const value of [null, false, 0, '', {}, []]) {
      expect(
        OperatorRunInputChangesSchema.safeParse({
          set: [{ inputId: 'target', value }],
          unset: [],
        }).success,
      ).toBe(true);
    }
  });

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
    expect(
      OperatorRunWorkflowInputSchema.parse({
        workflowId: '22222222-2222-4222-8222-222222222222',
        versionId: '33333333-3333-4333-8333-333333333333',
        sourceRunId: 'sentris-run-original',
      }),
    ).toEqual({
      workflowId: '22222222-2222-4222-8222-222222222222',
      versionId: '33333333-3333-4333-8333-333333333333',
      inputs: {},
      sourceRunId: 'sentris-run-original',
    });
    expect(
      OperatorRunWorkflowInputSchema.safeParse({
        workflowId: '22222222-2222-4222-8222-222222222222',
        versionId: '33333333-3333-4333-8333-333333333333',
        sourceRunId: 'sentris-run-original',
        inputs: { packageSpec: 'different-input' },
      }).success,
    ).toBe(false);
    expect(
      OperatorRunWorkflowInputSchema.safeParse({
        workflowId: '22222222-2222-4222-8222-222222222222',
        versionId: '33333333-3333-4333-8333-333333333333',
        sourceRunId: 'sentris-run-original',
        scopeId: '44444444-4444-4444-8444-444444444444',
      }).success,
    ).toBe(false);
    const inputChanges = {
      set: [{ inputId: 'packageSpec', value: 'minimist@1.2.9' }],
      unset: [],
    };
    expect(OperatorRunInputChangesSchema.parse(inputChanges)).toEqual(inputChanges);
    expect(OperatorRunInputChangesSchema.parse({ set: [], unset: ['scanIntensity'] })).toEqual({
      set: [],
      unset: ['scanIntensity'],
    });
    expect(
      OperatorRunInputChangesSchema.parse({
        set: [{ inputId: 'packageSpec', value: 'minimist@1.2.9' }],
        unset: ['scanIntensity'],
      }),
    ).toEqual({
      set: [{ inputId: 'packageSpec', value: 'minimist@1.2.9' }],
      unset: ['scanIntensity'],
    });
    for (const invalid of [
      { set: [], unset: [] },
      {
        set: [
          { inputId: 'target', value: 'one' },
          { inputId: 'target', value: 'two' },
        ],
        unset: [],
      },
      { set: [{ inputId: 'target', value: 'one' }], unset: ['target'] },
    ]) {
      expect(OperatorRunInputChangesSchema.safeParse(invalid).success).toBe(false);
    }
    expect(
      OperatorRunInputChangesSchema.safeParse({
        set: [
          { inputId: 'input01', value: 'one' },
          { inputId: 'input02', value: 'two' },
          { inputId: 'input03', value: 'three' },
          { inputId: 'input04', value: 'four' },
          { inputId: 'input05', value: 'five' },
          { inputId: 'input06', value: 'six' },
          { inputId: 'input07', value: 'seven' },
          { inputId: 'input08', value: 'eight' },
          { inputId: 'input09', value: 'nine' },
          { inputId: 'input10', value: 'ten' },
          { inputId: 'input11', value: 'eleven' },
          { inputId: 'input12', value: 'twelve' },
          { inputId: 'input13', value: 'thirteen' },
          { inputId: 'input14', value: 'fourteen' },
          { inputId: 'input15', value: 'fifteen' },
          { inputId: 'input16', value: 'sixteen' },
          { inputId: 'input17', value: 'seventeen' },
          { inputId: 'input18', value: 'eighteen' },
          { inputId: 'input19', value: 'nineteen' },
          { inputId: 'input20', value: 'twenty' },
        ],
        unset: ['input21'],
      }).success,
    ).toBe(false);
    expect(
      OperatorProposeRunInputChangesInputSchema.safeParse({
        sourceRunId: 'sentris-run-source',
        changes: [{ operation: 'set', inputId: 'target', value: 'legacy' }],
      }).success,
    ).toBe(false);
    expect(
      OperatorRunWorkflowInputSchema.parse({
        workflowId: '22222222-2222-4222-8222-222222222222',
        versionId: '33333333-3333-4333-8333-333333333333',
        sourceRunId: 'sentris-run-original',
        inputChanges,
      }).inputChanges,
    ).toEqual(inputChanges);
    expect(
      OperatorRunWorkflowInputSchema.safeParse({
        workflowId: '22222222-2222-4222-8222-222222222222',
        versionId: '33333333-3333-4333-8333-333333333333',
        inputChanges: { set: [], unset: ['packageSpec'] },
      }).success,
    ).toBe(false);
    const toolSchema = z.toJSONSchema(
      OPERATOR_COMMAND_DEFINITIONS.propose_run_input_changes.inputSchema,
    );
    expect(JSON.stringify(toolSchema)).not.toContain('"oneOf"');
    expect(toolSchema).toMatchObject({
      properties: {
        inputChanges: {
          type: 'object',
          properties: {
            set: { type: 'array' },
            unset: { type: 'array' },
          },
          required: ['set', 'unset'],
        },
      },
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
    expect(
      OperatorCreateTurnSchema.parse({
        clientTurnId: '11111111-1111-4111-8111-111111111111',
        message: 'Run the improved version',
        directCommand: {
          commandName: 'run_workflow',
          arguments: {
            workflowId: '22222222-2222-4222-8222-222222222222',
            versionId: '33333333-3333-4333-8333-333333333333',
            sourceRunId: 'sentris-run-original',
          },
        },
      }).directCommand,
    ).toEqual({
      commandName: 'run_workflow',
      arguments: {
        workflowId: '22222222-2222-4222-8222-222222222222',
        versionId: '33333333-3333-4333-8333-333333333333',
        inputs: {},
        sourceRunId: 'sentris-run-original',
      },
    });
  });

  it('accepts a bounded finding inspection as a direct read command', () => {
    expect(OPERATOR_COMMAND_DEFINITIONS.get_finding.effect).toBe('read');
    expect(
      OperatorCreateTurnSchema.parse({
        clientTurnId: SESSION_ID,
        message: 'Investigate this finding',
        directCommand: {
          commandName: 'get_finding',
          arguments: { findingId: 'finding-1' },
        },
      }).directCommand,
    ).toEqual({ commandName: 'get_finding', arguments: { findingId: 'finding-1' } });
  });

  it('includes raw Agent operation I/O only when explicitly requested', () => {
    expect(
      OperatorGetRunInputSchema.parse({
        runId: 'sentris-run-source',
        includeAgentIo: true,
      }),
    ).toEqual({ runId: 'sentris-run-source', includeAgentIo: true });
  });

  it('accepts one bounded improve-run journey separately from direct commands', () => {
    expect(
      OperatorCreateTurnSchema.parse({
        clientTurnId: SESSION_ID,
        message: 'Improve this run and compare the result',
        journey: { kind: 'improve_run', sourceRunId: 'sentris-run-source' },
      }).journey,
    ).toEqual({ kind: 'improve_run', sourceRunId: 'sentris-run-source' });
    expect(
      OperatorCreateTurnSchema.safeParse({
        clientTurnId: SESSION_ID,
        message: 'Ambiguous control request',
        directCommand: {
          commandName: 'get_run',
          arguments: { runId: 'sentris-run-source' },
        },
        journey: { kind: 'improve_run', sourceRunId: 'sentris-run-source' },
      }).success,
    ).toBe(false);
  });

  it('keeps run comparison read-only, distinct, and available as a direct review command', () => {
    expect(OPERATOR_COMMAND_DEFINITIONS.compare_runs.effect).toBe('read');
    expect(
      OperatorCompareRunsInputSchema.safeParse({
        sourceRunId: 'sentris-run-1',
        candidateRunId: 'sentris-run-1',
      }).success,
    ).toBe(false);
    expect(
      OperatorCreateTurnSchema.parse({
        clientTurnId: SESSION_ID,
        message: 'Compare the improved run with its source',
        directCommand: {
          commandName: 'compare_runs',
          arguments: {
            sourceRunId: 'sentris-run-source',
            candidateRunId: 'sentris-run-candidate',
          },
        },
      }).directCommand,
    ).toEqual({
      commandName: 'compare_runs',
      arguments: {
        sourceRunId: 'sentris-run-source',
        candidateRunId: 'sentris-run-candidate',
      },
    });
  });

  it('validates the evidence-based run comparison result contract', () => {
    expect(
      OperatorRunComparisonResultSchema.parse({
        kind: 'run-comparison',
        assessment: 'improved',
        comparable: true,
        source: {
          runId: 'sentris-run-source',
          workflowId: '22222222-2222-4222-8222-222222222222',
          workflowVersionId: '33333333-3333-4333-8333-333333333333',
          status: 'FAILED',
          durationMs: 10_000,
          trace: { availability: 'available', failedEventCount: 2 },
          findings: { availability: 'available', total: 1 },
        },
        candidate: {
          runId: 'sentris-run-candidate',
          workflowId: '22222222-2222-4222-8222-222222222222',
          workflowVersionId: '44444444-4444-4444-8444-444444444444',
          status: 'COMPLETED',
          durationMs: 8_000,
          trace: { availability: 'available', failedEventCount: 0 },
          findings: { availability: 'available', total: 2 },
        },
        changes: {
          statusChanged: true,
          failedEventCountDelta: -2,
          findingTotalDelta: 1,
          durationDeltaMs: -2_000,
        },
        successCriteria: {
          benchmarkVersionId: '44444444-4444-4444-8444-444444444444',
          criteria: [
            {
              criterion: {
                id: 'report-produced',
                title: 'Produces a report',
                kind: 'output_assertion',
                nodeRef: 'agent',
                path: '/report',
                operator: 'not_empty',
              },
              source: { outcome: 'failed', message: 'Output was empty', actual: '""' },
              candidate: {
                outcome: 'passed',
                message: 'Output was not empty',
                actual: '"Report"',
              },
              assessment: 'improved',
            },
          ],
        },
        caveats: ['Finding and duration changes are observations only.'],
      }).assessment,
    ).toBe('improved');
  });

  it('defines the current strict payload while accepting prior versioned and route-only storage', () => {
    const routeContext = {
      path: '/workflows/22222222-2222-4222-8222-222222222222',
      workflowId: '22222222-2222-4222-8222-222222222222',
    };
    const payload = {
      version: 2 as const,
      routeContext,
      directCommand: {
        commandName: 'get_run' as const,
        arguments: { runId: 'sentris-run-1' },
      },
    };

    expect(OperatorPersistedTurnPayloadSchema.parse(payload)).toEqual({
      ...payload,
      journey: null,
    });
    expect(OperatorStoredTurnContextSchema.parse(routeContext)).toEqual(routeContext);
    expect(OperatorStoredTurnContextSchema.parse(null)).toBeNull();
    expect(OperatorPersistedTurnPayloadSchema.safeParse({ ...payload, version: 1 }).success).toBe(
      false,
    );
    expect(OperatorPersistedTurnPayloadV1Schema.safeParse({ ...payload, version: 1 }).success).toBe(
      true,
    );
    expect(
      OperatorPersistedTurnPayloadSchema.safeParse({ ...payload, unexpected: true }).success,
    ).toBe(false);
  });
});

describe('Operator session stream contracts', () => {
  const session = {
    id: SESSION_ID,
    title: 'Investigation',
    approvalMode: 'ask' as const,
    status: 'active' as const,
    model: {
      provider: 'gemini' as const,
      modelId: 'gemini-3.5-flash',
      apiKeySecretId: '22222222-2222-4222-8222-222222222222',
      baseUrl: null,
    },
    createdAt: '2026-08-02T10:00:00.000Z',
    updatedAt: '2026-08-02T10:00:00.000Z',
    turns: [],
    messages: [],
    actions: [],
  };

  it('accepts strict v1 ready and full-snapshot envelopes', () => {
    expect(
      OperatorSessionStreamReadySchema.parse({
        version: 1,
        sessionId: SESSION_ID,
        mode: 'polling',
        intervalMs: 750,
      }),
    ).toEqual({ version: 1, sessionId: SESSION_ID, mode: 'polling', intervalMs: 750 });
    expect(OperatorSessionStreamSnapshotSchema.parse({ version: 1, session })).toEqual({
      version: 1,
      session,
    });
  });

  it('rejects unknown versions and unrecognized envelope fields', () => {
    expect(
      OperatorSessionStreamReadySchema.safeParse({
        version: 2,
        sessionId: SESSION_ID,
        mode: 'polling',
        intervalMs: 750,
      }).success,
    ).toBe(false);
    expect(
      OperatorSessionStreamSnapshotSchema.safeParse({
        version: 1,
        session,
        cursor: 'not-supported',
      }).success,
    ).toBe(false);
  });

  it('exposes a bounded transient read error without implementation details', () => {
    expect(
      OperatorSessionStreamErrorSchema.parse({
        version: 1,
        code: 'session_read_failed',
        message: 'Operator session update could not be read',
      }),
    ).toEqual({
      version: 1,
      code: 'session_read_failed',
      message: 'Operator session update could not be read',
    });
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
    expect(OPERATOR_COMMAND_DEFINITIONS.get_workflow_draft.effect).toBe('read');
    expect(OPERATOR_COMMAND_DEFINITIONS.propose_workflow_draft.effect).toBe('execute');
    expect(OPERATOR_COMMAND_DEFINITIONS.propose_workflow_edits.effect).toBe('execute');
    expect(OPERATOR_COMMAND_DEFINITIONS.revise_workflow_draft.effect).toBe('execute');
    expect(OPERATOR_COMMAND_DEFINITIONS.apply_workflow_draft.effect).toBe('consequential');
  });

  it('exposes bounded template discovery and unsaved template-backed proposals', () => {
    const definitions = OPERATOR_COMMAND_DEFINITIONS as Record<
      string,
      { effect: string; inputSchema: z.ZodType }
    >;

    expect(definitions.list_workflow_templates?.effect).toBe('read');
    expect(
      definitions.list_workflow_templates?.inputSchema.parse({
        search: 'website security',
        requiredComponentIds: ['sentris.nuclei.scan'],
        limit: 5,
      }),
    ).toEqual({
      search: 'website security',
      requiredComponentIds: ['sentris.nuclei.scan'],
      limit: 5,
    });
    expect(
      definitions.list_workflow_templates?.inputSchema.safeParse({
        requiredComponentIds: Array.from(
          { length: 21 },
          (_, index) => `sentris.component.${index}`,
        ),
      }).success,
    ).toBe(false);
    expect(
      OperatorListWorkflowTemplatesResultSchema.parse([
        {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          name: 'Web Attack Surface Quick Win Hunt',
          description: 'Run active checks against an authorized website.',
          category: 'bug-bounty',
          tags: ['web', 'nuclei'],
          isOfficial: true,
          isVerified: true,
          nodeCount: 2,
          edgeCount: 1,
          componentIds: ['core.workflow.entrypoint', 'sentris.nuclei.scan'],
          runtimeInputs: [],
          requiredSecrets: [],
        },
      ])[0]?.componentIds,
    ).toEqual(['core.workflow.entrypoint', 'sentris.nuclei.scan']);
    expect(definitions.propose_workflow_from_template?.effect).toBe('execute');
    expect(
      definitions.propose_workflow_from_template?.inputSchema.parse({
        templateId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        name: 'livespec.io security scan',
        runtimeInputDefaults: { liveUrls: ['https://livespec.io'] },
      }),
    ).toEqual({
      templateId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      name: 'livespec.io security scan',
      runtimeInputDefaults: { liveUrls: ['https://livespec.io'] },
    });
    expect(
      definitions.propose_workflow_from_template?.inputSchema.safeParse({
        templateId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        runtimeInputDefaults: Object.fromEntries(
          Array.from({ length: 26 }, (_, index) => [`input-${index}`, index]),
        ),
      }).success,
    ).toBe(false);
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
    expect(
      OperatorProposeWorkflowDraftInputSchema.safeParse({
        sourceRunId: 'sentris-run-original',
        graph,
      }).success,
    ).toBe(false);
    expect(
      OperatorProposeWorkflowDraftInputSchema.safeParse({
        workflowId: '22222222-2222-4222-8222-222222222222',
        baseVersionId: '33333333-3333-4333-8333-333333333333',
        sourceRunId: 'sentris-run-original',
        graph,
      }).success,
    ).toBe(true);
  });

  it('accepts bounded ID-based edits only for an immutable existing workflow version', () => {
    const input = {
      workflowId: '22222222-2222-4222-8222-222222222222',
      baseVersionId: '33333333-3333-4333-8333-333333333333',
      sourceRunId: 'sentris-run-original',
      summary: 'Use the configured Gemini model',
      operations: [
        {
          operation: 'patch_node' as const,
          nodeId: 'agent',
          setParameters: { modelId: 'gemini-2.5-pro' },
        },
        {
          operation: 'remove_edge' as const,
          edgeId: 'obsolete-edge',
        },
        {
          operation: 'set_success_criteria' as const,
          successCriteria: [
            {
              id: 'findings-produced',
              title: 'Produces at least one finding',
              kind: 'finding_count' as const,
              minimum: 1,
            },
          ],
        },
      ],
    };

    expect(OperatorProposeWorkflowEditsInputSchema.parse(input)).toEqual(input);
    expect(
      OperatorProposeWorkflowEditsInputSchema.safeParse({
        ...input,
        operations: [{ operation: 'patch_node', nodeId: 'agent' }],
      }).success,
    ).toBe(false);
    expect(
      OperatorProposeWorkflowEditsInputSchema.safeParse({
        ...input,
        operations: [],
      }).success,
    ).toBe(false);
    expect(
      OperatorProposeWorkflowEditsInputSchema.safeParse({
        baseVersionId: input.baseVersionId,
        operations: input.operations,
      }).success,
    ).toBe(false);
    expect(
      OperatorProposeWorkflowEditsInputSchema.safeParse({
        ...input,
        operations: [
          {
            operation: 'patch_node_config',
            nodeId: 'agent',
            params: { modelId: 'gemini-2.5-pro' },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('validates deterministic workflow success criteria', () => {
    expect(
      WorkflowSuccessCriteriaSchema.parse([
        {
          id: 'report-produced',
          title: 'Produces a report',
          kind: 'output_assertion',
          nodeRef: 'agent',
          path: '/report',
          operator: 'not_empty',
        },
        {
          id: 'findings-produced',
          title: 'Produces findings',
          kind: 'finding_count',
          minimum: 1,
        },
      ]),
    ).toHaveLength(2);
    expect(
      WorkflowSuccessCriteriaSchema.safeParse([
        {
          id: 'score',
          title: 'High confidence score',
          kind: 'output_assertion',
          nodeRef: 'agent',
          path: '/score',
          operator: 'gte',
          expected: '0.8',
        },
      ]).success,
    ).toBe(false);
    expect(
      WorkflowSuccessCriteriaSchema.safeParse([
        { id: 'duplicate', title: 'First', kind: 'finding_count', minimum: 1 },
        { id: 'duplicate', title: 'Second', kind: 'finding_count', maximum: 3 },
      ]).success,
    ).toBe(false);
  });

  it('publishes provider-compatible edit operations as one explicit enum', () => {
    const schema = z.toJSONSchema(OperatorProposeWorkflowEditsInputSchema) as any;

    expect(schema.properties.operations.items.properties.operation.enum).toEqual(
      OPERATOR_WORKFLOW_EDIT_OPERATIONS,
    );
    expect(schema.properties.operations.items).not.toHaveProperty('oneOf');
  });

  it('keeps compact draft and apply results typed for durable UI rendering', () => {
    const draftId = '44444444-4444-4444-8444-444444444444';
    expect(
      OperatorWorkflowDraftResultSchema.parse({
        kind: 'workflow-draft',
        draftId,
        mode: 'update',
        workflowId: '22222222-2222-4222-8222-222222222222',
        baseVersionId: '33333333-3333-4333-8333-333333333333',
        sourceRunId: 'sentris-run-original',
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
      }).sourceRunId,
    ).toBe('sentris-run-original');
    expect(
      OperatorWorkflowApplyResultSchema.parse({
        kind: 'workflow-applied',
        draftId,
        workflowId: '55555555-5555-4555-8555-555555555555',
        versionId: '66666666-6666-4666-8666-666666666666',
        version: 1,
        created: true,
        name: graph.name,
        sourceRunId: 'sentris-run-original',
      }).sourceRunId,
    ).toBe('sentris-run-original');
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

describe('Operator durable plans', () => {
  const validSteps = [
    {
      id: 'inspect-run',
      label: 'Inspect the source run',
      commandName: 'get_run',
      arguments: { runId: 'sentris-run-source' },
    },
    {
      id: 'inspect-finding',
      label: 'Inspect the finding',
      commandName: 'get_finding',
      arguments: { findingId: 'finding-1' },
    },
    {
      id: 'triage-finding',
      label: 'Mark the finding triaged',
      commandName: 'update_finding_triage',
      arguments: { findingId: 'finding-1', status: 'triaged' },
    },
  ] as const;

  it('accepts a bounded exact-command plan and its execution journey reference', () => {
    expect(
      OperatorProposePlanInputSchema.parse({ title: 'Review and triage', steps: validSteps }).steps,
    ).toHaveLength(3);
    expect(
      OperatorCreateTurnSchema.parse({
        clientTurnId: SESSION_ID,
        message: 'Run the reviewed plan',
        journey: {
          kind: 'execute_plan',
          planActionId: '22222222-2222-4222-8222-222222222222',
        },
      }).journey,
    ).toEqual({
      kind: 'execute_plan',
      planActionId: '22222222-2222-4222-8222-222222222222',
    });
  });

  it('binds a template-backed workflow draft through save and exact-version launch', () => {
    const draftId = '44444444-4444-4444-8444-444444444444';
    const workflowId = '55555555-5555-4555-8555-555555555555';
    const versionId = '66666666-6666-4666-8666-666666666666';
    const steps = OperatorProposePlanInputSchema.parse({
      title: 'Create and run website scan',
      steps: [
        {
          id: 'draft',
          label: 'Prepare workflow draft',
          commandName: 'propose_workflow_from_template',
          arguments: {
            templateId: '11111111-1111-4111-8111-111111111111',
            runtimeInputDefaults: { liveUrls: ['https://example.com'] },
          },
        },
        {
          id: 'save',
          label: 'Save workflow version',
          commandName: 'apply_workflow_draft',
          arguments: {},
          bindings: [
            {
              sourceStepId: 'draft',
              sourcePointer: '/draftId',
              targetPointer: '/draftId',
            },
          ],
        },
        {
          id: 'run',
          label: 'Run saved workflow',
          commandName: 'run_workflow',
          arguments: { inputs: { liveUrls: ['https://example.com'] } },
          bindings: [
            {
              sourceStepId: 'save',
              sourcePointer: '/workflowId',
              targetPointer: '/workflowId',
            },
            {
              sourceStepId: 'save',
              sourcePointer: '/versionId',
              targetPointer: '/versionId',
            },
          ],
        },
      ],
    }).steps;

    expect(resolveOperatorPlanStepArguments(steps[1]!, new Map([['draft', { draftId }]]))).toEqual({
      draftId,
    });
    expect(
      resolveOperatorPlanStepArguments(steps[2]!, new Map([['save', { workflowId, versionId }]])),
    ).toEqual({
      workflowId,
      versionId,
      inputs: { liveUrls: ['https://example.com'] },
    });
  });

  it('resolves one bounded string argument from an earlier step result', () => {
    const workflowId = '33333333-3333-4333-8333-333333333333';
    const steps = OperatorProposePlanInputSchema.parse({
      title: 'Inspect one discovered workflow',
      steps: [
        {
          id: 'list-workflows',
          label: 'List workflows',
          commandName: 'list_workflows',
          arguments: {},
        },
        {
          id: 'inspect-workflow',
          label: 'Inspect the workflow',
          commandName: 'get_workflow',
          arguments: {},
          bindings: [
            {
              sourceStepId: 'list-workflows',
              sourcePointer: '/0/id',
              targetPointer: '/workflowId',
            },
          ],
        },
        {
          id: 'list-runs',
          label: 'List its runs',
          commandName: 'list_runs',
          arguments: { limit: 5 },
          bindings: [
            {
              sourceStepId: 'list-workflows',
              sourcePointer: '/0/id',
              targetPointer: '/workflowId',
            },
          ],
        },
      ],
    }).steps;

    expect(resolveOperatorPlanStepArguments(steps[0]!, new Map())).toEqual({});
    expect(
      resolveOperatorPlanStepArguments(
        steps[1]!,
        new Map([['list-workflows', [{ id: workflowId }]]]),
      ),
    ).toEqual({
      workflowId,
    });
    expect(() =>
      resolveOperatorPlanStepArguments(steps[1]!, new Map([['list-workflows', []]])),
    ).toThrow('did not resolve to a string');
  });

  it('rejects duplicate steps, invalid typed arguments, and turn-scoped MCP operations', () => {
    expect(
      OperatorProposePlanInputSchema.safeParse({
        title: 'Duplicate plan',
        steps: [...validSteps.slice(0, 2), { ...validSteps[0] }],
      }).success,
    ).toBe(false);
    expect(
      OperatorProposePlanInputSchema.safeParse({
        title: 'Invalid arguments',
        steps: [...validSteps.slice(0, 2), { ...validSteps[2], arguments: {} }],
      }).success,
    ).toBe(false);
    expect(
      OperatorProposePlanInputSchema.safeParse({
        title: 'MCP plan',
        steps: [
          ...validSteps.slice(0, 2),
          {
            id: 'invoke-mcp',
            label: 'Invoke MCP',
            commandName: 'invoke_mcp_tool',
            arguments: {},
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      OperatorProposePlanInputSchema.safeParse({
        title: 'Forward reference',
        steps: [
          {
            ...validSteps[0],
            arguments: {},
            bindings: [
              {
                sourceStepId: 'inspect-finding',
                sourcePointer: '/id',
                targetPointer: '/runId',
              },
            ],
          },
          ...validSteps.slice(1),
        ],
      }).success,
    ).toBe(false);
    expect(
      OperatorProposePlanInputSchema.safeParse({
        title: 'Conflicting argument',
        steps: [
          validSteps[0],
          {
            ...validSteps[1],
            bindings: [
              {
                sourceStepId: 'inspect-run',
                sourcePointer: '/findingId',
                targetPointer: '/findingId',
              },
            ],
          },
          validSteps[2],
        ],
      }).success,
    ).toBe(false);
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
