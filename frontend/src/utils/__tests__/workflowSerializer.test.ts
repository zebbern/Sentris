import { describe, expect, it } from 'bun:test';
import type { Node as ReactFlowNode, Edge as ReactFlowEdge } from '@xyflow/react';
import { MarkerType } from '@xyflow/react';
import type { FrontendNodeData } from '@/schemas/node';

import {
  serializeNodes,
  serializeEdges,
  serializeWorkflowForCreate,
  serializeWorkflowForUpdate,
  deserializeNodes,
  deserializeEdges,
} from '../workflowSerializer';

// Helpers
function makeReactFlowNode(
  id: string,
  componentId: string,
  overrides: Partial<FrontendNodeData> = {},
): ReactFlowNode<FrontendNodeData> {
  return {
    id,
    type: 'workflow',
    position: { x: 100, y: 200 },
    data: {
      label: 'Test Node',
      config: { params: {}, inputOverrides: {} },
      componentId,
      componentSlug: componentId,
      ...overrides,
    },
  } as ReactFlowNode<FrontendNodeData>;
}

function makeReactFlowEdge(
  id: string,
  source: string,
  target: string,
  overrides: Partial<ReactFlowEdge> = {},
): ReactFlowEdge {
  return {
    id,
    source,
    target,
    sourceHandle: 'output',
    targetHandle: 'input',
    ...overrides,
  } as ReactFlowEdge;
}

describe('serializeNodes', () => {
  it('strips runtime data and preserves position', () => {
    const node = makeReactFlowNode('n1', 'scanner', {
      status: 'running',
      executionTime: 1234,
    });
    const result = serializeNodes([node]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('n1');
    expect(result[0].type).toBe('scanner');
    expect(result[0].position).toEqual({ x: 100, y: 200 });
    expect(result[0].data.label).toBe('Test Node');
    // Should not contain runtime fields
    expect((result[0].data as Record<string, unknown>).status).toBeUndefined();
  });

  it('preserves config params and inputOverrides', () => {
    const node = makeReactFlowNode('n1', 'scanner', {
      config: {
        params: { apiKey: 'sk-123', model: 'gpt-4' },
        inputOverrides: { prompt: 'hello' },
      },
    });
    const result = serializeNodes([node]);
    const config = result[0].data.config as Record<string, unknown>;
    expect((config.params as Record<string, unknown>).apiKey).toBe('sk-123');
    expect((config.inputOverrides as Record<string, unknown>).prompt).toBe('hello');
  });

  it('preserves UI metadata', () => {
    const node = makeReactFlowNode('n1', 'scanner', {
      ui: { size: { width: 300, height: 200 } },
    });
    const result = serializeNodes([node]);
    const config = result[0].data.config as Record<string, unknown>;
    expect(config.__ui).toEqual({ size: { width: 300, height: 200 } });
  });

  it('falls back to componentSlug then type for componentId', () => {
    const node = {
      id: 'n1',
      type: 'fallback-type',
      position: { x: 0, y: 0 },
      data: {
        label: 'Test',
        config: { params: {}, inputOverrides: {} },
      },
    } as ReactFlowNode<FrontendNodeData>;
    const result = serializeNodes([node]);
    expect(result[0].type).toBe('fallback-type');
  });

  it('serializes multiple nodes', () => {
    const nodes = [makeReactFlowNode('n1', 'scanner'), makeReactFlowNode('n2', 'processor')];
    const result = serializeNodes(nodes);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('scanner');
    expect(result[1].type).toBe('processor');
  });
});

describe('serializeEdges', () => {
  it('serializes basic edge properties', () => {
    const edge = makeReactFlowEdge('e1', 'n1', 'n2');
    const result = serializeEdges([edge]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('e1');
    expect(result[0].source).toBe('n1');
    expect(result[0].target).toBe('n2');
    expect(result[0].sourceHandle).toBe('output');
    expect(result[0].targetHandle).toBe('input');
  });

  it('defaults type to "default"', () => {
    const edge = makeReactFlowEdge('e1', 'n1', 'n2');
    const result = serializeEdges([edge]);
    expect(result[0].type).toBe('default');
  });

  it('handles null sourceHandle gracefully', () => {
    const edge = makeReactFlowEdge('e1', 'n1', 'n2', {
      sourceHandle: null,
    });
    const result = serializeEdges([edge]);
    expect(result[0].sourceHandle).toBeUndefined();
  });

  it('preserves edge type when set', () => {
    const edge = makeReactFlowEdge('e1', 'n1', 'n2', { type: 'smoothstep' });
    const result = serializeEdges([edge]);
    expect(result[0].type).toBe('smoothstep');
  });
});

describe('serializeWorkflowForCreate', () => {
  it('creates a workflow DTO with correct structure', () => {
    const nodes = [makeReactFlowNode('n1', 'scanner')];
    const edges = [makeReactFlowEdge('e1', 'n1', 'n2')];
    const result = serializeWorkflowForCreate('My Workflow', 'A description', nodes, edges);

    expect(result.name).toBe('My Workflow');
    expect(result.description).toBe('A description');
    expect(result.nodes).toHaveLength(1);
    expect(result.edges).toHaveLength(1);
    expect(result.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it('defaults description to empty string', () => {
    const result = serializeWorkflowForCreate('Test', undefined, [], []);
    expect(result.description).toBe('');
  });
});

describe('serializeWorkflowForUpdate', () => {
  it('includes workflow id', () => {
    const result = serializeWorkflowForUpdate('wf-123', 'Updated', 'desc', [], []);
    expect(result.id).toBe('wf-123');
    expect(result.name).toBe('Updated');
  });
});

describe('deserializeNodes', () => {
  it('converts backend nodes to React Flow format', () => {
    const workflow = {
      graph: {
        nodes: [
          {
            id: 'n1',
            type: 'scanner',
            position: { x: 50, y: 75 },
            data: { label: 'Scanner', config: { params: { key: 'val' }, inputOverrides: {} } },
          },
        ],
        edges: [],
      },
    };
    const result = deserializeNodes(workflow);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('n1');
    expect(result[0].type).toBe('workflow'); // All nodes use 'workflow' type
    expect(result[0].position).toEqual({ x: 50, y: 75 });
    expect(result[0].data.label).toBe('Scanner');
    expect(result[0].data.componentId).toBe('scanner');
    expect(result[0].data.componentSlug).toBe('scanner');
    expect((result[0].data as FrontendNodeData).status).toBe('idle');
  });

  it('builds input mappings from edges', () => {
    const workflow = {
      graph: {
        nodes: [
          {
            id: 'n1',
            type: 'scanner',
            position: { x: 0, y: 0 },
            data: { label: 'A', config: { params: {}, inputOverrides: {} } },
          },
          {
            id: 'n2',
            type: 'processor',
            position: { x: 0, y: 0 },
            data: { label: 'B', config: { params: {}, inputOverrides: {} } },
          },
        ],
        edges: [
          { id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'output', targetHandle: 'input' },
        ],
      },
    };
    const result = deserializeNodes(workflow);
    const target = result.find((n) => n.id === 'n2');
    expect((target?.data as FrontendNodeData).inputs).toEqual({
      input: { source: 'n1', output: 'output' },
    });
  });

  it('restores UI metadata from __ui', () => {
    const workflow = {
      graph: {
        nodes: [
          {
            id: 'n1',
            type: 'text-block',
            position: { x: 0, y: 0 },
            data: {
              label: 'Text',
              config: {
                params: {},
                inputOverrides: {},
                __ui: { size: { width: 400, height: 300 } },
              },
            },
          },
        ],
        edges: [],
      },
    };
    const result = deserializeNodes(workflow);
    expect((result[0].data as FrontendNodeData).ui).toEqual({ size: { width: 400, height: 300 } });
  });
});

describe('deserializeEdges', () => {
  it('converts backend edges to React Flow format', () => {
    const workflow = {
      graph: {
        edges: [
          {
            id: 'e1',
            source: 'n1',
            target: 'n2',
            sourceHandle: 'output',
            targetHandle: 'input',
          },
        ],
      },
    };
    const result = deserializeEdges(workflow);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('e1');
    expect(result[0].source).toBe('n1');
    expect(result[0].target).toBe('n2');
    expect(result[0].animated).toBe(false);
    expect(result[0].markerEnd).toEqual({
      type: MarkerType.Arrow,
      width: 22,
      height: 22,
    });
  });

  it('normalizes tool-export handle to tools', () => {
    const workflow = {
      graph: {
        edges: [
          {
            id: 'e1',
            source: 'n1',
            target: 'n2',
            sourceHandle: 'tool-export',
            targetHandle: 'tools',
          },
        ],
      },
    };
    const result = deserializeEdges(workflow);
    expect(result[0].sourceHandle).toBe('tools');
  });

  it('defaults edge type to "default"', () => {
    const workflow = {
      graph: {
        edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
      },
    };
    const result = deserializeEdges(workflow);
    expect(result[0].type).toBe('default');
  });

  it('preserves edge type when set', () => {
    const workflow = {
      graph: {
        edges: [
          {
            id: 'e1',
            source: 'n1',
            target: 'n2',
            type: 'smoothstep' as const,
          },
        ],
      },
    };
    const result = deserializeEdges(workflow);
    expect(result[0].type).toBe('smoothstep');
  });
});
