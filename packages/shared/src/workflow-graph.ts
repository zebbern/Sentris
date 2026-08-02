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

export const WorkflowGraphObjectSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  description: z.string().optional(),
  nodes: z.array(WorkflowNodeSchema).min(1),
  edges: z.array(WorkflowEdgeSchema),
  viewport: WorkflowViewportSchema.default({ x: 0, y: 0, zoom: 1 }),
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
export type WorkflowGraph = z.infer<typeof WorkflowGraphSchema>;
