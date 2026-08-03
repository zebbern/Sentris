import { z } from 'zod';

export const WorkflowViewportSchema = z.object({
  x: z.number(),
  y: z.number(),
  zoom: z.number(),
});

export const WorkflowNodeDataSchema = z.object({
  label: z.string(),
  config: z
    .object({
      params: z.record(z.string(), z.unknown()).default({}),
      inputOverrides: z.record(z.string(), z.unknown()).default({}),
      joinStrategy: z.enum(['all', 'any', 'first']).optional(),
      streamId: z.string().optional(),
      groupId: z.string().optional(),
      maxConcurrency: z.number().int().positive().optional(),
      mode: z.enum(['normal', 'tool']).optional(),
      toolConfig: z
        .object({
          boundInputIds: z.array(z.string()).default([]),
          exposedInputIds: z.array(z.string()).default([]),
        })
        .optional(),
      connectedToolNodeIds: z.array(z.string()).optional(),
    })
    .default({ params: {}, inputOverrides: {} }),
  dynamicInputs: z.array(z.record(z.string(), z.unknown())).optional(),
  dynamicOutputs: z.array(z.record(z.string(), z.unknown())).optional(),
});

export const WorkflowNodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
  data: WorkflowNodeDataSchema,
});

export const WorkflowEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
  kind: z.enum(['success', 'error']).optional(),
  type: z.enum(['default', 'smoothstep', 'step', 'straight', 'bezier']).optional(),
});

const WorkflowSuccessCriterionIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'Use letters, numbers, dots, dashes, or underscores');

const WorkflowSuccessCriterionBaseSchema = z.object({
  id: WorkflowSuccessCriterionIdSchema,
  title: z.string().trim().min(1).max(191),
});

export const WorkflowOutputSuccessCriterionSchema = WorkflowSuccessCriterionBaseSchema.extend({
  kind: z.literal('output_assertion'),
  nodeRef: z.string().trim().min(1).max(191),
  path: z
    .string()
    .max(1_024)
    .refine(
      (value) => value === '' || value.startsWith('/'),
      'Output path must be an RFC 6901 JSON Pointer or empty for the node output itself',
    ),
  operator: z.enum(['exists', 'not_empty', 'equals', 'contains', 'gte', 'lte']),
  expected: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
})
  .strict()
  .superRefine((criterion, context) => {
    const hasExpected = Object.hasOwn(criterion, 'expected');
    if (criterion.operator === 'exists' || criterion.operator === 'not_empty') {
      if (hasExpected) {
        context.addIssue({
          code: 'custom',
          message: `${criterion.operator} does not accept an expected value`,
          path: ['expected'],
        });
      }
      return;
    }
    if (!hasExpected) {
      context.addIssue({
        code: 'custom',
        message: `${criterion.operator} requires an expected value`,
        path: ['expected'],
      });
      return;
    }
    if (criterion.operator === 'contains' && typeof criterion.expected !== 'string') {
      context.addIssue({
        code: 'custom',
        message: 'contains requires a string expected value',
        path: ['expected'],
      });
    }
    if (
      (criterion.operator === 'gte' || criterion.operator === 'lte') &&
      typeof criterion.expected !== 'number'
    ) {
      context.addIssue({
        code: 'custom',
        message: `${criterion.operator} requires a numeric expected value`,
        path: ['expected'],
      });
    }
  });

export const WorkflowFindingCountSuccessCriterionSchema = WorkflowSuccessCriterionBaseSchema.extend(
  {
    kind: z.literal('finding_count'),
    minimum: z.number().int().nonnegative().optional(),
    maximum: z.number().int().nonnegative().optional(),
  },
)
  .strict()
  .superRefine((criterion, context) => {
    if (criterion.minimum === undefined && criterion.maximum === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'finding_count requires a minimum or maximum',
      });
    }
    if (
      criterion.minimum !== undefined &&
      criterion.maximum !== undefined &&
      criterion.minimum > criterion.maximum
    ) {
      context.addIssue({
        code: 'custom',
        message: 'minimum cannot exceed maximum',
        path: ['minimum'],
      });
    }
  });

export const WorkflowSuccessCriterionSchema = z.union([
  WorkflowOutputSuccessCriterionSchema,
  WorkflowFindingCountSuccessCriterionSchema,
]);

export const WorkflowSuccessCriteriaSchema = z
  .array(WorkflowSuccessCriterionSchema)
  .max(20)
  .superRefine((criteria, context) => {
    const ids = new Set<string>();
    for (const [index, criterion] of criteria.entries()) {
      if (ids.has(criterion.id)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate success criterion id: ${criterion.id}`,
          path: [index, 'id'],
        });
      }
      ids.add(criterion.id);
    }
  });

export const WorkflowGraphObjectSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  description: z.string().optional(),
  nodes: z.array(WorkflowNodeSchema).min(1),
  edges: z.array(WorkflowEdgeSchema),
  viewport: WorkflowViewportSchema.default({ x: 0, y: 0, zoom: 1 }),
  successCriteria: WorkflowSuccessCriteriaSchema.optional(),
});

export const WorkflowGraphSchema = WorkflowGraphObjectSchema.refine(
  (data) => {
    const portInputs = new Set<string>();
    for (const edge of data.edges) {
      const targetHandle = edge.targetHandle ?? edge.sourceHandle;
      if (!targetHandle || targetHandle === 'tools') continue;

      const key = `${edge.target}:${targetHandle}`;
      if (portInputs.has(key)) return false;
      portInputs.add(key);
    }
    return true;
  },
  {
    message:
      'Multiple edges connecting to the same input port are not allowed. Each port must have only one source. (Note: The "tools" port allows multiple connections.)',
    path: ['edges'],
  },
);

export type WorkflowViewport = z.infer<typeof WorkflowViewportSchema>;
export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;
export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>;
export type WorkflowSuccessCriterion = z.infer<typeof WorkflowSuccessCriterionSchema>;
export type WorkflowGraph = z.infer<typeof WorkflowGraphSchema>;
