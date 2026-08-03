import { z } from 'zod';

import { ExecutionStatusSchema } from './execution.js';
import { LLM_PROVIDER_IDS } from './ai-model-catalog.js';
import { FindingTriageStatusSchema, UpdateFindingTriageSchema } from './finding-triage.js';
import {
  FindingDataAvailabilitySchema,
  FindingObservationSeveritySchema,
} from './findings/findingObservation.js';
import type { McpOperationInvocationRequest } from './mcp-invocation.js';
import {
  WorkflowEdgeSchema,
  WorkflowGraphObjectSchema,
  WorkflowNodeSchema,
  WorkflowSuccessCriteriaSchema,
  WorkflowSuccessCriterionSchema,
  type WorkflowGraph,
} from './workflow-graph.js';

export const OPERATOR_APPROVAL_MODES = ['ask', 'auto'] as const;
export const OperatorApprovalModeSchema = z.enum(OPERATOR_APPROVAL_MODES);
export type OperatorApprovalMode = z.infer<typeof OperatorApprovalModeSchema>;

export const OPERATOR_COMMAND_EFFECTS = ['read', 'execute', 'consequential'] as const;
export const OperatorCommandEffectSchema = z.enum(OPERATOR_COMMAND_EFFECTS);
export type OperatorCommandEffect = z.infer<typeof OperatorCommandEffectSchema>;

export const OPERATOR_SESSION_STATUSES = ['active', 'archived'] as const;
export const OperatorSessionStatusSchema = z.enum(OPERATOR_SESSION_STATUSES);
export type OperatorSessionStatus = z.infer<typeof OperatorSessionStatusSchema>;

export const OPERATOR_TURN_STATUSES = [
  'queued',
  'running',
  'awaiting_approval',
  'completed',
  'failed',
  'cancelled',
] as const;
export const OperatorTurnStatusSchema = z.enum(OPERATOR_TURN_STATUSES);
export type OperatorTurnStatus = z.infer<typeof OperatorTurnStatusSchema>;

export const OPERATOR_MESSAGE_ROLES = ['user', 'assistant'] as const;
export const OperatorMessageRoleSchema = z.enum(OPERATOR_MESSAGE_ROLES);
export type OperatorMessageRole = z.infer<typeof OperatorMessageRoleSchema>;

export const OPERATOR_ACTION_STATUSES = [
  'proposed',
  'pending_approval',
  'approved',
  'rejected',
  'executing',
  'succeeded',
  'failed',
] as const;
export const OperatorActionStatusSchema = z.enum(OPERATOR_ACTION_STATUSES);
export type OperatorActionStatus = z.infer<typeof OperatorActionStatusSchema>;

export const OperatorModelConfigSchema = z
  .object({
    provider: z.enum(LLM_PROVIDER_IDS),
    modelId: z.string().trim().min(1).max(191),
    apiKeySecretId: z.string().uuid(),
    baseUrl: z.string().trim().url().max(2_048).optional().nullable(),
  })
  .strict();
export type OperatorModelConfig = z.infer<typeof OperatorModelConfigSchema>;

export const OperatorRouteContextSchema = z
  .object({
    path: z.string().trim().min(1).max(2_048),
    workflowId: z.string().uuid().optional(),
    runId: z.string().trim().min(1).max(191).optional(),
  })
  .strict();
export type OperatorRouteContext = z.infer<typeof OperatorRouteContextSchema>;

const WorkflowIdSchema = z.string().uuid();
const RunIdSchema = z.string().trim().min(1).max(191);
const FindingIdSchema = z.string().trim().min(1).max(512);
const MAX_OPERATOR_WORKFLOW_DRAFT_BYTES = 256 * 1024;
const MAX_OPERATOR_WORKFLOW_EDIT_BYTES = 128 * 1024;
const MAX_OPERATOR_WORKFLOW_DRAFT_NODES = 200;
const MAX_OPERATOR_WORKFLOW_DRAFT_EDGES = 1_000;
const MAX_OPERATOR_WORKFLOW_EDIT_OPERATIONS = 100;

export const OperatorListWorkflowsInputSchema = z
  .object({
    search: z.string().trim().min(1).max(191).optional(),
    limit: z.number().int().min(1).max(100).default(25),
  })
  .strict();

export const OperatorGetWorkflowInputSchema = z
  .object({
    workflowId: WorkflowIdSchema,
    versionId: z.string().uuid().optional(),
    version: z.number().int().positive().optional(),
  })
  .strict();

export const OperatorListComponentsInputSchema = z
  .object({
    search: z.string().trim().min(1).max(191).optional(),
    category: z.string().trim().min(1).max(64).optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();

export const OperatorGetComponentInputSchema = z
  .object({ componentId: z.string().trim().min(1).max(191) })
  .strict();

export const OperatorWorkflowGraphSchema = WorkflowGraphObjectSchema.extend({
  name: z.string().trim().min(1).max(191),
  description: z.string().max(8_000).optional(),
  nodes: z.array(WorkflowNodeSchema).min(1).max(MAX_OPERATOR_WORKFLOW_DRAFT_NODES),
  edges: z.array(WorkflowEdgeSchema).max(MAX_OPERATOR_WORKFLOW_DRAFT_EDGES),
}).superRefine((graph, context) => {
  const portInputs = new Set<string>();
  for (const edge of graph.edges) {
    const targetHandle = edge.targetHandle ?? edge.sourceHandle;
    if (!targetHandle || targetHandle === 'tools') continue;
    const key = `${edge.target}:${targetHandle}`;
    if (portInputs.has(key)) {
      context.addIssue({
        code: 'custom',
        message: 'Multiple edges cannot connect to the same non-tools input port',
        path: ['edges'],
      });
      break;
    }
    portInputs.add(key);
  }

  const serialized = JSON.stringify(graph);
  if (new TextEncoder().encode(serialized).byteLength > MAX_OPERATOR_WORKFLOW_DRAFT_BYTES) {
    context.addIssue({
      code: 'custom',
      message: `Workflow draft exceeds ${MAX_OPERATOR_WORKFLOW_DRAFT_BYTES} bytes`,
      path: [],
    });
  }
});

const OperatorWorkflowEntityIdSchema = z.string().trim().min(1).max(191);

export const OPERATOR_WORKFLOW_EDIT_OPERATIONS = [
  'set_workflow_metadata',
  'set_success_criteria',
  'patch_node',
  'add_node',
  'replace_node',
  'remove_node',
  'add_edge',
  'replace_edge',
  'remove_edge',
] as const;

const OPERATOR_WORKFLOW_EDIT_FIELDS = {
  set_workflow_metadata: ['operation', 'name', 'description'],
  set_success_criteria: ['operation', 'successCriteria'],
  patch_node: [
    'operation',
    'nodeId',
    'label',
    'position',
    'setParameters',
    'removeParameterIds',
    'setInputOverrides',
    'removeInputOverrideIds',
  ],
  add_node: ['operation', 'node'],
  replace_node: ['operation', 'nodeId', 'node'],
  remove_node: ['operation', 'nodeId'],
  add_edge: ['operation', 'edge'],
  replace_edge: ['operation', 'edgeId', 'edge'],
  remove_edge: ['operation', 'edgeId'],
} as const satisfies Record<(typeof OPERATOR_WORKFLOW_EDIT_OPERATIONS)[number], readonly string[]>;

export const OperatorWorkflowEditOperationSchema = z
  .object({
    operation: z.enum(OPERATOR_WORKFLOW_EDIT_OPERATIONS),
    name: z.string().trim().min(1).max(191).optional(),
    description: z.string().max(8_000).nullable().optional(),
    successCriteria: WorkflowSuccessCriteriaSchema.optional(),
    nodeId: OperatorWorkflowEntityIdSchema.optional(),
    label: z.string().trim().min(1).max(191).optional(),
    position: z.object({ x: z.number(), y: z.number() }).strict().optional(),
    setParameters: z.record(z.string().trim().min(1).max(191), z.unknown()).optional(),
    removeParameterIds: z.array(OperatorWorkflowEntityIdSchema).max(100).optional(),
    setInputOverrides: z.record(z.string().trim().min(1).max(191), z.unknown()).optional(),
    removeInputOverrideIds: z.array(OperatorWorkflowEntityIdSchema).max(100).optional(),
    node: WorkflowNodeSchema.optional(),
    edgeId: OperatorWorkflowEntityIdSchema.optional(),
    edge: WorkflowEdgeSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const requireField = (field: keyof typeof value): void => {
      if (value[field] === undefined) {
        context.addIssue({
          code: 'custom',
          message: `${value.operation} requires ${field}`,
          path: [field],
        });
      }
    };

    switch (value.operation) {
      case 'set_workflow_metadata':
        if (value.name === undefined && value.description === undefined) {
          context.addIssue({
            code: 'custom',
            message: 'set_workflow_metadata requires name or description',
          });
        }
        break;
      case 'set_success_criteria':
        requireField('successCriteria');
        break;
      case 'patch_node':
        requireField('nodeId');
        if (
          value.label === undefined &&
          value.position === undefined &&
          value.setParameters === undefined &&
          value.removeParameterIds === undefined &&
          value.setInputOverrides === undefined &&
          value.removeInputOverrideIds === undefined
        ) {
          context.addIssue({
            code: 'custom',
            message: 'patch_node requires at least one node change',
          });
        }
        for (const [setValues, removedIds, path] of [
          [value.setParameters, value.removeParameterIds, 'removeParameterIds'],
          [value.setInputOverrides, value.removeInputOverrideIds, 'removeInputOverrideIds'],
        ] as const) {
          if (!setValues || !removedIds) continue;
          const duplicate = removedIds.find((id) => Object.hasOwn(setValues, id));
          if (duplicate) {
            context.addIssue({
              code: 'custom',
              message: `${duplicate} cannot be set and removed in the same node patch`,
              path: [path],
            });
          }
        }
        break;
      case 'add_node':
        requireField('node');
        break;
      case 'replace_node':
        requireField('nodeId');
        requireField('node');
        if (value.node && value.nodeId && value.node.id !== value.nodeId) {
          context.addIssue({
            code: 'custom',
            message: 'replacement node id must match nodeId',
            path: ['node', 'id'],
          });
        }
        break;
      case 'remove_node':
        requireField('nodeId');
        break;
      case 'add_edge':
        requireField('edge');
        break;
      case 'replace_edge':
        requireField('edgeId');
        requireField('edge');
        if (value.edge && value.edgeId && value.edge.id !== value.edgeId) {
          context.addIssue({
            code: 'custom',
            message: 'replacement edge id must match edgeId',
            path: ['edge', 'id'],
          });
        }
        break;
      case 'remove_edge':
        requireField('edgeId');
        break;
      default: {
        const unsupported: never = value.operation;
        throw new Error(`Unsupported workflow edit operation: ${String(unsupported)}`);
      }
    }

    const allowedFields = new Set<string>(OPERATOR_WORKFLOW_EDIT_FIELDS[value.operation]);
    for (const field of Object.keys(value)) {
      if (!allowedFields.has(field)) {
        context.addIssue({
          code: 'custom',
          message: `${field} is not valid for ${value.operation}`,
          path: [field],
        });
      }
    }
  });
export type OperatorWorkflowEditOperation = z.infer<typeof OperatorWorkflowEditOperationSchema>;

export const OperatorProposeWorkflowEditsInputSchema = z
  .object({
    workflowId: WorkflowIdSchema,
    baseVersionId: z.string().uuid(),
    sourceRunId: RunIdSchema.optional(),
    summary: z.string().trim().min(1).max(2_000).optional(),
    operations: z
      .array(OperatorWorkflowEditOperationSchema)
      .min(1)
      .max(MAX_OPERATOR_WORKFLOW_EDIT_OPERATIONS),
  })
  .strict()
  .superRefine((value, context) => {
    const serialized = JSON.stringify(value);
    if (new TextEncoder().encode(serialized).byteLength > MAX_OPERATOR_WORKFLOW_EDIT_BYTES) {
      context.addIssue({
        code: 'custom',
        message: `Workflow edits exceed ${MAX_OPERATOR_WORKFLOW_EDIT_BYTES} bytes`,
        path: ['operations'],
      });
    }
  });

export const OperatorProposeWorkflowDraftInputSchema = z
  .object({
    workflowId: WorkflowIdSchema.optional(),
    baseVersionId: z.string().uuid().optional(),
    sourceRunId: RunIdSchema.optional(),
    summary: z.string().trim().min(1).max(2_000).optional(),
    graph: OperatorWorkflowGraphSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (Boolean(value.workflowId) !== Boolean(value.baseVersionId)) {
      context.addIssue({
        code: 'custom',
        message: 'workflowId and baseVersionId must either both be provided or both be omitted',
        path: value.workflowId ? ['baseVersionId'] : ['workflowId'],
      });
    }
    if (value.sourceRunId && (!value.workflowId || !value.baseVersionId)) {
      context.addIssue({
        code: 'custom',
        message: 'sourceRunId is only valid for an update draft',
        path: ['sourceRunId'],
      });
    }
  });

export const OperatorApplyWorkflowDraftInputSchema = z
  .object({ draftId: z.string().uuid() })
  .strict();

export const OperatorWorkflowDraftValidationSchema = z
  .object({
    valid: z.boolean(),
    errors: z.array(z.string().max(2_000)).max(50),
  })
  .strict();

export const OperatorWorkflowGraphDiffSchema = z
  .object({
    metadataChanged: z.array(z.enum(['name', 'description'])),
    successCriteriaChanged: z.boolean().default(false),
    addedNodeIds: z.array(z.string()),
    removedNodeIds: z.array(z.string()),
    changedNodeIds: z.array(z.string()),
    addedEdgeIds: z.array(z.string()),
    removedEdgeIds: z.array(z.string()),
    changedEdgeIds: z.array(z.string()),
  })
  .strict();

export const OperatorWorkflowDraftResultSchema = z
  .object({
    kind: z.literal('workflow-draft'),
    draftId: z.string().uuid(),
    mode: z.enum(['create', 'update']),
    workflowId: WorkflowIdSchema.nullable(),
    baseVersionId: z.string().uuid().nullable(),
    sourceRunId: RunIdSchema.optional(),
    name: z.string(),
    digest: z.string().min(1),
    validation: OperatorWorkflowDraftValidationSchema,
    diff: OperatorWorkflowGraphDiffSchema,
  })
  .strict();
export type OperatorWorkflowDraftResult = z.infer<typeof OperatorWorkflowDraftResultSchema>;

export const OperatorWorkflowApplyResultSchema = z
  .object({
    kind: z.literal('workflow-applied'),
    draftId: z.string().uuid(),
    workflowId: WorkflowIdSchema,
    versionId: z.string().uuid(),
    version: z.number().int().positive(),
    created: z.boolean(),
    staged: z.boolean().default(false),
    name: z.string(),
    sourceRunId: RunIdSchema.optional(),
  })
  .strict();
export type OperatorWorkflowApplyResult = z.infer<typeof OperatorWorkflowApplyResultSchema>;

export const OperatorPromoteWorkflowVersionInputSchema = z
  .object({
    workflowId: WorkflowIdSchema,
    versionId: z.string().uuid(),
    baseVersionId: z.string().uuid(),
    candidateRunId: RunIdSchema,
  })
  .strict();

export const OperatorWorkflowPromotionResultSchema = z
  .object({
    kind: z.literal('workflow-version-promoted'),
    workflowId: WorkflowIdSchema,
    versionId: z.string().uuid(),
    version: z.number().int().positive(),
    name: z.string(),
    candidateRunId: RunIdSchema,
    alreadyCurrent: z.boolean(),
  })
  .strict();
export type OperatorWorkflowPromotionResult = z.infer<typeof OperatorWorkflowPromotionResultSchema>;

export const OperatorWorkflowDraftDetailSchema = OperatorWorkflowDraftResultSchema.extend({
  proposalActionId: z.string().uuid(),
  sessionId: z.string().uuid(),
  proposedGraph: OperatorWorkflowGraphSchema,
  baseGraph: OperatorWorkflowGraphSchema.nullable(),
});
export type OperatorWorkflowDraftDetail = Omit<
  z.infer<typeof OperatorWorkflowDraftDetailSchema>,
  'proposedGraph' | 'baseGraph'
> & {
  proposedGraph: WorkflowGraph;
  baseGraph: WorkflowGraph | null;
};

export const OperatorListRunsInputSchema = z
  .object({
    workflowId: WorkflowIdSchema.optional(),
    status: ExecutionStatusSchema.optional(),
    limit: z.number().int().min(1).max(100).default(25),
  })
  .strict();

export const OperatorGetRunInputSchema = z.object({ runId: RunIdSchema }).strict();

export const OperatorCompareRunsInputSchema = z
  .object({
    sourceRunId: RunIdSchema,
    candidateRunId: RunIdSchema,
  })
  .strict()
  .refine((value) => value.sourceRunId !== value.candidateRunId, {
    message: 'sourceRunId and candidateRunId must identify different runs',
    path: ['candidateRunId'],
  });

export const OPERATOR_RUN_COMPARISON_ASSESSMENTS = [
  'improved',
  'regressed',
  'unchanged',
  'inconclusive',
] as const;
export const OperatorRunComparisonAssessmentSchema = z.enum(OPERATOR_RUN_COMPARISON_ASSESSMENTS);
export type OperatorRunComparisonAssessment = z.infer<typeof OperatorRunComparisonAssessmentSchema>;

export const OperatorRunComparisonEvidenceSchema = z
  .object({
    runId: RunIdSchema,
    workflowId: WorkflowIdSchema,
    workflowVersionId: z.string().uuid().nullable(),
    status: ExecutionStatusSchema,
    durationMs: z.number().nonnegative(),
    trace: z
      .object({
        availability: z.enum(['available', 'unavailable']),
        failedEventCount: z.number().int().nonnegative().nullable(),
      })
      .strict(),
    findings: z
      .object({
        availability: FindingDataAvailabilitySchema,
        total: z.number().int().nonnegative().nullable(),
      })
      .strict(),
  })
  .strict();
export type OperatorRunComparisonEvidence = z.infer<typeof OperatorRunComparisonEvidenceSchema>;

export const OPERATOR_SUCCESS_CRITERION_OUTCOMES = ['passed', 'failed', 'inconclusive'] as const;
export const OperatorSuccessCriterionOutcomeSchema = z.enum(OPERATOR_SUCCESS_CRITERION_OUTCOMES);
export type OperatorSuccessCriterionOutcome = z.infer<typeof OperatorSuccessCriterionOutcomeSchema>;

export const OperatorSuccessCriterionEvaluationSchema = z
  .object({
    outcome: OperatorSuccessCriterionOutcomeSchema,
    message: z.string().trim().min(1).max(500),
    actual: z.string().max(700).optional(),
  })
  .strict();
export type OperatorSuccessCriterionEvaluation = z.infer<
  typeof OperatorSuccessCriterionEvaluationSchema
>;

export const OperatorSuccessCriterionComparisonSchema = z
  .object({
    criterion: WorkflowSuccessCriterionSchema,
    source: OperatorSuccessCriterionEvaluationSchema,
    candidate: OperatorSuccessCriterionEvaluationSchema,
    assessment: OperatorRunComparisonAssessmentSchema,
  })
  .strict();
export type OperatorSuccessCriterionComparison = z.infer<
  typeof OperatorSuccessCriterionComparisonSchema
>;

export const OperatorRunSuccessCriteriaComparisonSchema = z
  .object({
    benchmarkVersionId: z.string().uuid(),
    criteria: z.array(OperatorSuccessCriterionComparisonSchema).max(20),
  })
  .strict();
export type OperatorRunSuccessCriteriaComparison = z.infer<
  typeof OperatorRunSuccessCriteriaComparisonSchema
>;

export const OperatorRunComparisonResultSchema = z
  .object({
    kind: z.literal('run-comparison'),
    assessment: OperatorRunComparisonAssessmentSchema,
    comparable: z.boolean(),
    source: OperatorRunComparisonEvidenceSchema,
    candidate: OperatorRunComparisonEvidenceSchema,
    changes: z
      .object({
        statusChanged: z.boolean(),
        failedEventCountDelta: z.number().int().nullable(),
        findingTotalDelta: z.number().int().nullable(),
        durationDeltaMs: z.number(),
      })
      .strict(),
    successCriteria: OperatorRunSuccessCriteriaComparisonSchema.nullable().optional(),
    caveats: z.array(z.string().trim().min(1).max(500)).max(10),
  })
  .strict();
export type OperatorRunComparisonResult = z.infer<typeof OperatorRunComparisonResultSchema>;

export const OperatorRunWorkflowInputSchema = z
  .object({
    workflowId: WorkflowIdSchema,
    versionId: z.string().uuid(),
    inputs: z.record(z.string(), z.unknown()).default({}),
    scopeId: z.string().uuid().optional(),
    sourceRunId: RunIdSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.sourceRunId) return;
    if (Object.keys(value.inputs).length > 0) {
      context.addIssue({
        code: 'custom',
        message: 'inputs must be empty when sourceRunId reuses the source run inputs',
        path: ['inputs'],
      });
    }
    if (value.scopeId) {
      context.addIssue({
        code: 'custom',
        message: 'scopeId must be omitted when sourceRunId reuses the source run scope',
        path: ['scopeId'],
      });
    }
  });

export const OperatorCancelRunInputSchema = z.object({ runId: RunIdSchema }).strict();

export const OperatorRetryRunInputSchema = z.object({ runId: RunIdSchema }).strict();

export const OperatorListFindingsInputSchema = z
  .object({
    search: z.string().trim().min(1).max(200).optional(),
    severity: FindingObservationSeveritySchema.optional(),
    workflowId: z.string().trim().min(1).max(200).optional(),
    runId: z.string().trim().min(1).max(200).optional(),
    triageStatus: FindingTriageStatusSchema.optional(),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();

export const OperatorGetFindingInputSchema = z.object({ findingId: FindingIdSchema }).strict();

export const OperatorUpdateFindingTriageInputSchema = z
  .object({
    findingId: FindingIdSchema,
    ...UpdateFindingTriageSchema.shape,
  })
  .strict()
  .refine(
    (data) =>
      data.status !== undefined ||
      data.assigneeUserId !== undefined ||
      data.severityOverride !== undefined ||
      data.notes !== undefined,
    {
      message:
        'At least one of status, assigneeUserId, severityOverride, or notes must be provided',
    },
  );

const McpCapabilitySnapshotIdSchema = z.string().uuid();
const McpSourceIdSchema = z.string().trim().min(1).max(512);

export const OperatorListMcpServersInputSchema = z
  .object({
    search: z.string().trim().min(1).max(191).optional(),
    limit: z.number().int().min(1).max(100).default(25),
  })
  .strict();

export const OperatorListMcpCapabilitiesInputSchema = z
  .object({ serverId: z.string().uuid() })
  .strict();

export const OperatorInvokeMcpToolInputSchema = z
  .object({
    capabilitySnapshotId: McpCapabilitySnapshotIdSchema,
    sourceId: McpSourceIdSchema,
    name: z.string().trim().min(1).max(128),
    arguments: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export const OperatorReadMcpResourceInputSchema = z
  .object({
    capabilitySnapshotId: McpCapabilitySnapshotIdSchema,
    sourceId: McpSourceIdSchema,
    uri: z.string().trim().min(1).max(8_192),
    templateUri: z.string().trim().min(1).max(8_192).optional(),
  })
  .strict();

export const OperatorGetMcpPromptInputSchema = z
  .object({
    capabilitySnapshotId: McpCapabilitySnapshotIdSchema,
    sourceId: McpSourceIdSchema,
    name: z.string().trim().min(1).max(8_192),
    arguments: z.record(z.string(), z.string()).default({}),
  })
  .strict();

export const OPERATOR_COMMAND_DEFINITIONS = {
  list_workflows: {
    description:
      "List the user's existing Sentris workflows. Use this to resolve a workflow name before inspecting or running it.",
    effect: 'read',
    inputSchema: OperatorListWorkflowsInputSchema,
  },
  get_workflow: {
    description:
      'Inspect one existing workflow version, including its editable credential-safe graph, graph summary, and exact runtime-input contract. Use this before proposing a change or running it.',
    effect: 'read',
    inputSchema: OperatorGetWorkflowInputSchema,
  },
  list_components: {
    description:
      'Search the current Sentris component catalog before authoring a workflow. Returns exact component IDs and compact capabilities.',
    effect: 'read',
    inputSchema: OperatorListComponentsInputSchema,
  },
  get_component: {
    description:
      'Inspect one current component definition, including exact parameters, inputs, outputs, and examples. Use exact IDs and port names in workflow drafts.',
    effect: 'read',
    inputSchema: OperatorGetComponentInputSchema,
  },
  propose_workflow_draft: {
    description:
      'Propose and compile-check a complete new workflow graph without saving it. Existing workflows should use propose_workflow_edits so unchanged graph data is not regenerated. A valid proposal can then be applied separately.',
    effect: 'execute',
    inputSchema: OperatorProposeWorkflowDraftInputSchema,
  },
  propose_workflow_edits: {
    description: `Propose and compile-check bounded ID-based changes to an existing immutable workflow version without saving it. Use the exact workflowId, baseVersionId, node IDs, and edge IDs returned by get_workflow. Allowed operation values are: ${OPERATOR_WORKFLOW_EDIT_OPERATIONS.join(', ')}. For node configuration use patch_node with setParameters and/or setInputOverrides; structured values are recursively merged so omitted nested fields remain unchanged. For example, setInputOverrides: { chatModel: { provider: 'gemini', modelId: 'gemini-3.6-flash' } }. The backend materializes the full graph and returns the normal draft diff for review.`,
    effect: 'execute',
    inputSchema: OperatorProposeWorkflowEditsInputSchema,
  },
  apply_workflow_draft: {
    description:
      'Apply one previously validated workflow draft, creating a workflow or one new immutable version. This is consequential in Ask mode and rejects a stale base version.',
    effect: 'consequential',
    inputSchema: OperatorApplyWorkflowDraftInputSchema,
  },
  promote_workflow_version: {
    description:
      'Promote a tested candidate workflow version after reviewing its recorded comparison. The candidate run must be terminal and reference the exact version; baseVersionId must still be the workflow current version so Keep cannot overwrite a newer edit.',
    effect: 'consequential',
    inputSchema: OperatorPromoteWorkflowVersionInputSchema,
  },
  list_runs: {
    description:
      'List recent workflow runs, optionally restricted to a workflow or execution status.',
    effect: 'read',
    inputSchema: OperatorListRunsInputSchema,
  },
  get_run: {
    description:
      'Inspect one workflow run. Terminal runs include a bounded result, failed/recent trace evidence, and run-scoped findings; active runs include current status.',
    effect: 'read',
    inputSchema: OperatorGetRunInputSchema,
  },
  compare_runs: {
    description:
      'Compare one terminal improved run with its terminal source run. The verdict uses matching stored inputs/scope, terminal outcome, and exact trace failure counts. Finding totals and duration are reported only as observations because reruns can vary.',
    effect: 'read',
    inputSchema: OperatorCompareRunsInputSchema,
  },
  run_workflow: {
    description:
      'Run an existing workflow version with runtime inputs keyed by the exact IDs returned from get_workflow. Pass its returned immutable versionId, and use only when the user explicitly asks to run it.',
    effect: 'execute',
    inputSchema: OperatorRunWorkflowInputSchema,
  },
  cancel_run: {
    description:
      'Cancel an active workflow run. This is consequential and may require user approval.',
    effect: 'consequential',
    inputSchema: OperatorCancelRunInputSchema,
  },
  retry_run: {
    description:
      'Retry a workflow run as a new run using the original workflow version and stored inputs. Use only when the user explicitly asks to retry it.',
    effect: 'execute',
    inputSchema: OperatorRetryRunInputSchema,
  },
  list_findings: {
    description:
      'List security findings with authoritative triage state and data-health metadata. Use this to resolve a finding before inspecting or updating it.',
    effect: 'read',
    inputSchema: OperatorListFindingsInputSchema,
  },
  get_finding: {
    description:
      'Inspect one security finding, including bounded raw evidence and authoritative triage state.',
    effect: 'read',
    inputSchema: OperatorGetFindingInputSchema,
  },
  update_finding_triage: {
    description:
      'Update the status, assignee, severity override, or notes for one finding. Use only when the user explicitly asks for that triage change.',
    effect: 'execute',
    inputSchema: OperatorUpdateFindingTriageInputSchema,
  },
  list_mcp_servers: {
    description:
      "List the user's saved MCP servers and readiness. Use this before selecting a server capability.",
    effect: 'read',
    inputSchema: OperatorListMcpServersInputSchema,
  },
  list_mcp_capabilities: {
    description:
      'Discover one saved MCP server and materialize an immutable capability snapshot for this Operator turn.',
    effect: 'read',
    inputSchema: OperatorListMcpCapabilitiesInputSchema,
  },
  invoke_mcp_tool: {
    description:
      'Invoke one tool from an immutable MCP capability snapshot. MCP annotations are hints, so this is consequential in Ask mode.',
    effect: 'consequential',
    inputSchema: OperatorInvokeMcpToolInputSchema,
  },
  read_mcp_resource: {
    description:
      'Read an exact resource or an expanded resource template from an immutable MCP capability snapshot.',
    effect: 'read',
    inputSchema: OperatorReadMcpResourceInputSchema,
  },
  get_mcp_prompt: {
    description:
      'Get a prompt from an immutable MCP capability snapshot using optional string arguments.',
    effect: 'read',
    inputSchema: OperatorGetMcpPromptInputSchema,
  },
} as const satisfies Record<
  string,
  {
    description: string;
    effect: OperatorCommandEffect;
    inputSchema: z.ZodType;
  }
>;

export const OPERATOR_COMMAND_NAMES = Object.keys(
  OPERATOR_COMMAND_DEFINITIONS,
) as (keyof typeof OPERATOR_COMMAND_DEFINITIONS)[];
export const OperatorCommandNameSchema = z.enum(OPERATOR_COMMAND_NAMES);
export type OperatorCommandName = z.infer<typeof OperatorCommandNameSchema>;

export type OperatorCommandInputMap = {
  list_workflows: z.infer<typeof OperatorListWorkflowsInputSchema>;
  get_workflow: z.infer<typeof OperatorGetWorkflowInputSchema>;
  list_components: z.infer<typeof OperatorListComponentsInputSchema>;
  get_component: z.infer<typeof OperatorGetComponentInputSchema>;
  propose_workflow_draft: z.infer<typeof OperatorProposeWorkflowDraftInputSchema>;
  propose_workflow_edits: z.infer<typeof OperatorProposeWorkflowEditsInputSchema>;
  apply_workflow_draft: z.infer<typeof OperatorApplyWorkflowDraftInputSchema>;
  promote_workflow_version: z.infer<typeof OperatorPromoteWorkflowVersionInputSchema>;
  list_runs: z.infer<typeof OperatorListRunsInputSchema>;
  get_run: z.infer<typeof OperatorGetRunInputSchema>;
  compare_runs: z.infer<typeof OperatorCompareRunsInputSchema>;
  run_workflow: z.infer<typeof OperatorRunWorkflowInputSchema>;
  cancel_run: z.infer<typeof OperatorCancelRunInputSchema>;
  retry_run: z.infer<typeof OperatorRetryRunInputSchema>;
  list_findings: z.infer<typeof OperatorListFindingsInputSchema>;
  get_finding: z.infer<typeof OperatorGetFindingInputSchema>;
  update_finding_triage: z.infer<typeof OperatorUpdateFindingTriageInputSchema>;
  list_mcp_servers: z.infer<typeof OperatorListMcpServersInputSchema>;
  list_mcp_capabilities: z.infer<typeof OperatorListMcpCapabilitiesInputSchema>;
  invoke_mcp_tool: z.infer<typeof OperatorInvokeMcpToolInputSchema>;
  read_mcp_resource: z.infer<typeof OperatorReadMcpResourceInputSchema>;
  get_mcp_prompt: z.infer<typeof OperatorGetMcpPromptInputSchema>;
};

export const OperatorDirectCommandSchema = z.discriminatedUnion('commandName', [
  z
    .object({
      commandName: z.literal('apply_workflow_draft'),
      arguments: OperatorApplyWorkflowDraftInputSchema,
    })
    .strict(),
  z
    .object({
      commandName: z.literal('promote_workflow_version'),
      arguments: OperatorPromoteWorkflowVersionInputSchema,
    })
    .strict(),
  z
    .object({
      commandName: z.literal('get_run'),
      arguments: OperatorGetRunInputSchema,
    })
    .strict(),
  z
    .object({
      commandName: z.literal('compare_runs'),
      arguments: OperatorCompareRunsInputSchema,
    })
    .strict(),
  z
    .object({
      commandName: z.literal('run_workflow'),
      arguments: OperatorRunWorkflowInputSchema,
    })
    .strict(),
  z
    .object({
      commandName: z.literal('cancel_run'),
      arguments: OperatorCancelRunInputSchema,
    })
    .strict(),
  z
    .object({
      commandName: z.literal('retry_run'),
      arguments: OperatorRetryRunInputSchema,
    })
    .strict(),
]);
export type OperatorDirectCommand = z.infer<typeof OperatorDirectCommandSchema>;

const OperatorPersistedTurnPayloadV1DirectCommandSchema = z.union([
  OperatorDirectCommandSchema,
  z
    .object({
      commandName: z.literal('promote_workflow_version'),
      arguments: OperatorPromoteWorkflowVersionInputSchema.omit({ baseVersionId: true }),
    })
    .strict(),
]);

export const OperatorJourneySchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('improve_run'),
      sourceRunId: RunIdSchema,
    })
    .strict(),
]);
export type OperatorJourney = z.infer<typeof OperatorJourneySchema>;

export const OperatorRunImprovementReferenceSchema = z
  .object({
    sourceRunId: RunIdSchema,
    sessionId: z.string().uuid(),
    turnId: z.string().uuid(),
    createdAt: z.string().datetime(),
  })
  .strict();
export type OperatorRunImprovementReference = z.infer<typeof OperatorRunImprovementReferenceSchema>;

export const OperatorRunImprovementLookupSchema = z
  .object({ improvement: OperatorRunImprovementReferenceSchema.nullable() })
  .strict();
export type OperatorRunImprovementLookup = z.infer<typeof OperatorRunImprovementLookupSchema>;

export const OPERATOR_PERSISTED_TURN_PAYLOAD_VERSION = 2 as const;
export const OperatorPersistedTurnPayloadSchema = z
  .object({
    version: z.literal(OPERATOR_PERSISTED_TURN_PAYLOAD_VERSION),
    routeContext: OperatorRouteContextSchema.nullable(),
    directCommand: OperatorDirectCommandSchema.nullable(),
    journey: OperatorJourneySchema.nullable().default(null),
  })
  .strict();
export type OperatorPersistedTurnPayload = z.infer<typeof OperatorPersistedTurnPayloadSchema>;

export const OperatorPersistedTurnPayloadV1Schema = z
  .object({
    version: z.literal(1),
    routeContext: OperatorRouteContextSchema.nullable(),
    directCommand: OperatorPersistedTurnPayloadV1DirectCommandSchema.nullable(),
    journey: OperatorJourneySchema.nullable().default(null),
  })
  .strict();
export type OperatorPersistedTurnPayloadV1 = z.infer<typeof OperatorPersistedTurnPayloadV1Schema>;

/**
 * JSONB compatibility shape for Operator turns. Route-only objects and null predate
 * structured direct commands; all newly persisted rows use the versioned payload.
 */
export const OperatorStoredTurnContextSchema = z
  .union([
    OperatorPersistedTurnPayloadSchema,
    OperatorPersistedTurnPayloadV1Schema,
    OperatorRouteContextSchema,
  ])
  .nullable();
export type OperatorStoredTurnContext = z.input<typeof OperatorStoredTurnContextSchema>;

export const OperatorCreateSessionSchema = z
  .object({
    approvalMode: OperatorApprovalModeSchema.default('ask'),
    model: OperatorModelConfigSchema,
  })
  .strict();
export type OperatorCreateSession = z.infer<typeof OperatorCreateSessionSchema>;

export const OperatorUpdateSessionSchema = z
  .object({
    approvalMode: OperatorApprovalModeSchema.optional(),
    model: OperatorModelConfigSchema.optional(),
    title: z.string().trim().min(1).max(191).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');
export type OperatorUpdateSession = z.infer<typeof OperatorUpdateSessionSchema>;

export const OperatorCreateTurnSchema = z
  .object({
    clientTurnId: z.string().uuid(),
    message: z.string().trim().min(1).max(20_000),
    context: OperatorRouteContextSchema.optional(),
    directCommand: OperatorDirectCommandSchema.optional(),
    journey: OperatorJourneySchema.optional(),
  })
  .strict()
  .refine((value) => !(value.directCommand && value.journey), {
    message: 'directCommand and journey cannot be used together',
    path: ['journey'],
  });
export type OperatorCreateTurn = z.infer<typeof OperatorCreateTurnSchema>;

export const OperatorActionDecisionSchema = z
  .object({
    decision: z.enum(['approved', 'rejected']),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();
export type OperatorActionDecision = z.infer<typeof OperatorActionDecisionSchema>;

export interface OperatorSessionSummary {
  id: string;
  title: string;
  approvalMode: OperatorApprovalMode;
  status: OperatorSessionStatus;
  model: OperatorModelConfig;
  createdAt: string;
  updatedAt: string;
}

export interface OperatorTurnView {
  id: string;
  sessionId: string;
  status: OperatorTurnStatus;
  temporalWorkflowId: string | null;
  temporalRunId: string | null;
  context: OperatorRouteContext | null;
  /** Present for current API responses; optional so pre-field snapshots remain readable. */
  journey?: OperatorJourney | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface OperatorMessageView {
  id: string;
  sessionId: string;
  turnId: string;
  sequence: number;
  role: OperatorMessageRole;
  content: string;
  createdAt: string;
}

export interface OperatorActionView {
  id: string;
  sessionId: string;
  turnId: string;
  toolCallId: string;
  commandName: OperatorCommandName;
  effect: OperatorCommandEffect;
  approvalMode: OperatorApprovalMode;
  approvalRequired: boolean;
  status: OperatorActionStatus;
  version: number;
  arguments: Record<string, unknown>;
  result: unknown;
  error: string | null;
  runId: string | null;
  createdAt: string;
  decidedAt: string | null;
  completedAt: string | null;
}

export interface OperatorSessionDetail extends OperatorSessionSummary {
  turns: OperatorTurnView[];
  messages: OperatorMessageView[];
  actions: OperatorActionView[];
}

export const OPERATOR_SESSION_STREAM_VERSION = 1 as const;

const OperatorSessionSummaryStreamSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string(),
    approvalMode: OperatorApprovalModeSchema,
    status: OperatorSessionStatusSchema,
    model: OperatorModelConfigSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

const OperatorTurnStreamSchema = z
  .object({
    id: z.string().uuid(),
    sessionId: z.string().uuid(),
    status: OperatorTurnStatusSchema,
    temporalWorkflowId: z.string().nullable(),
    temporalRunId: z.string().nullable(),
    context: OperatorRouteContextSchema.nullable(),
    journey: OperatorJourneySchema.nullable().optional(),
    error: z.string().nullable(),
    createdAt: z.string(),
    startedAt: z.string().nullable(),
    completedAt: z.string().nullable(),
  })
  .strict();

const OperatorMessageStreamSchema = z
  .object({
    id: z.string().uuid(),
    sessionId: z.string().uuid(),
    turnId: z.string().uuid(),
    sequence: z.number().int().nonnegative(),
    role: OperatorMessageRoleSchema,
    content: z.string(),
    createdAt: z.string(),
  })
  .strict();

const OperatorActionStreamSchema = z
  .object({
    id: z.string().uuid(),
    sessionId: z.string().uuid(),
    turnId: z.string().uuid(),
    toolCallId: z.string(),
    commandName: OperatorCommandNameSchema,
    effect: OperatorCommandEffectSchema,
    approvalMode: OperatorApprovalModeSchema,
    approvalRequired: z.boolean(),
    status: OperatorActionStatusSchema,
    version: z.number().int().nonnegative(),
    arguments: z.record(z.string(), z.unknown()),
    result: z.unknown(),
    error: z.string().nullable(),
    runId: z.string().nullable(),
    createdAt: z.string(),
    decidedAt: z.string().nullable(),
    completedAt: z.string().nullable(),
  })
  .strict();

const OperatorSessionDetailStreamSchema = OperatorSessionSummaryStreamSchema.extend({
  turns: z.array(OperatorTurnStreamSchema),
  messages: z.array(OperatorMessageStreamSchema),
  actions: z.array(OperatorActionStreamSchema),
}).strict();

export const OperatorSessionStreamReadySchema = z
  .object({
    version: z.literal(OPERATOR_SESSION_STREAM_VERSION),
    sessionId: z.string().uuid(),
    mode: z.literal('polling'),
    intervalMs: z.number().int().min(750).max(1_000),
  })
  .strict();
export type OperatorSessionStreamReady = z.infer<typeof OperatorSessionStreamReadySchema>;

export const OperatorSessionStreamSnapshotSchema = z
  .object({
    version: z.literal(OPERATOR_SESSION_STREAM_VERSION),
    session: OperatorSessionDetailStreamSchema,
  })
  .strict();
export type OperatorSessionStreamSnapshot = z.infer<typeof OperatorSessionStreamSnapshotSchema>;

export const OperatorSessionStreamErrorSchema = z
  .object({
    version: z.literal(OPERATOR_SESSION_STREAM_VERSION),
    code: z.literal('session_read_failed'),
    message: z.literal('Operator session update could not be read'),
  })
  .strict();
export type OperatorSessionStreamError = z.infer<typeof OperatorSessionStreamErrorSchema>;

export interface OperatorTurnAccepted {
  turnId: string;
  status: OperatorTurnStatus;
}

export interface OperatorModelContext {
  session: OperatorSessionSummary & {
    organizationId: string;
    userId: string;
  };
  turn: OperatorTurnView;
  messages: OperatorMessageView[];
  actions: OperatorActionView[];
}

export interface OperatorPreparedAction {
  action: OperatorActionView;
  disposition: 'execute' | 'wait_for_approval' | 'rejected' | 'already_completed';
}

export interface OperatorCommandExecutionResult {
  action: OperatorActionView;
  result: unknown;
  launchedRunId?: string;
  mcpOperationRequest?: McpOperationInvocationRequest;
}

export interface OperatorRunObservation {
  runId: string;
  workflowId: string;
  status: string;
  terminal: boolean;
  result?: unknown;
}
