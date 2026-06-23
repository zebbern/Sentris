import { describe, expect, it, beforeAll } from 'bun:test';

import '@sentris/worker/components'; // Register components
import { componentRegistry } from '@sentris/component-sdk';
import type { WorkflowGraphDto } from '../../workflows/dto/workflow-graph.dto';
import { compileWorkflowGraph } from '../compiler';
import { validateWorkflowGraph, type ValidationResult } from '../validator';
import type { WorkflowDefinition, WorkflowAction, WorkflowEdge } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a WorkflowDefinition by hand (bypasses the compiler's own throw-on-error).
 * This lets us test the validator directly for known-invalid graphs.
 */
function buildDefinition(
  graph: WorkflowGraphDto,
  overrides: Partial<WorkflowDefinition> = {},
): WorkflowDefinition {
  const incomingEdges = new Map<string, Set<string>>();
  for (const node of graph.nodes) {
    incomingEdges.set(node.id, new Set());
  }
  for (const edge of graph.edges) {
    incomingEdges.get(edge.target)?.add(edge.source);
  }

  const actions: WorkflowAction[] = graph.nodes.map((node) => {
    const config = (node.data?.config ?? {}) as Record<string, unknown>;
    const inputMappings: WorkflowAction['inputMappings'] = {};

    for (const edge of graph.edges.filter((e) => e.target === node.id)) {
      const targetHandle = edge.targetHandle ?? edge.sourceHandle;
      const sourceHandle = edge.sourceHandle ?? '__self__';
      if (targetHandle) {
        inputMappings[targetHandle] = { sourceRef: edge.source, sourceHandle };
      }
    }

    return {
      ref: node.id,
      componentId: node.type,
      params: (config.params ?? {}) as Record<string, unknown>,
      inputOverrides: (config.inputOverrides ?? {}) as Record<string, unknown>,
      dependsOn: Array.from(incomingEdges.get(node.id) ?? []),
      inputMappings,
    };
  });

  const entryAction = actions.find((a) => a.componentId === 'core.workflow.entrypoint');
  const entryRef = entryAction?.ref ?? actions[0]?.ref ?? 'entry';

  const edges: WorkflowEdge[] = graph.edges.map((e) => ({
    id: e.id,
    sourceRef: e.source,
    targetRef: e.target,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
    kind: 'success' as const,
  }));

  const nodes: WorkflowDefinition['nodes'] = {};
  for (const node of graph.nodes) {
    const config = (node.data?.config ?? {}) as Record<string, unknown>;
    nodes[node.id] = {
      ref: node.id,
      label: node.data?.label,
      mode: (config.mode as 'normal' | 'tool') ?? 'normal',
    };
  }

  const dependencyCounts: Record<string, number> = {};
  for (const action of actions) {
    dependencyCounts[action.ref] = action.dependsOn.length;
  }

  return {
    version: 2,
    title: graph.name,
    description: graph.description,
    entrypoint: { ref: entryRef },
    nodes,
    edges,
    dependencyCounts,
    actions,
    config: { environment: 'default', timeoutSeconds: 0 },
    loopBodies: {},
    ...overrides,
  };
}

/** Compile then validate — only use for graphs expected to be valid. */
function compileAndValidate(graph: WorkflowGraphDto): ValidationResult {
  const compiled = compileWorkflowGraph(graph);
  return validateWorkflowGraph(graph, compiled);
}

/** Minimal valid graph with a single entry-point node. */
function makeMinimalGraph(overrides: Partial<WorkflowGraphDto> = {}): WorkflowGraphDto {
  return {
    name: 'Test workflow',
    nodes: [
      {
        id: 'entry',
        type: 'core.workflow.entrypoint',
        position: { x: 0, y: 0 },
        data: {
          label: 'Entry',
          config: {
            params: {
              runtimeInputs: [{ id: 'text', label: 'Text Input', type: 'text', required: false }],
            },
            inputOverrides: {},
          },
        },
      },
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    ...overrides,
  };
}

/** Build a simple two-node graph with an edge between them. */
function makeTwoNodeGraph(opts?: {
  sourceHandle?: string;
  targetHandle?: string;
  secondType?: string;
  secondParams?: Record<string, unknown>;
  secondInputOverrides?: Record<string, unknown>;
}): WorkflowGraphDto {
  const secondType = opts?.secondType ?? 'core.http.request';
  const secondParams = opts?.secondParams ?? { method: 'GET' };
  const secondInputOverrides = opts?.secondInputOverrides ?? { url: 'https://example.com' };

  return {
    name: 'Two-node workflow',
    nodes: [
      {
        id: 'entry',
        type: 'core.workflow.entrypoint',
        position: { x: 0, y: 0 },
        data: {
          label: 'Entry Point',
          config: {
            params: {
              runtimeInputs: [{ id: 'text', label: 'Text', type: 'text', required: false }],
            },
            inputOverrides: {},
          },
        },
      },
      {
        id: 'node2',
        type: secondType,
        position: { x: 0, y: 100 },
        data: {
          label: 'Second Node',
          config: {
            params: secondParams,
            inputOverrides: secondInputOverrides,
          },
        },
      },
    ],
    edges: [
      {
        id: 'e1',
        source: 'entry',
        target: 'node2',
        sourceHandle: opts?.sourceHandle,
        targetHandle: opts?.targetHandle,
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('validateWorkflowGraph', () => {
  beforeAll(() => {
    const entrypoint = componentRegistry.get('core.workflow.entrypoint');
    if (!entrypoint) {
      throw new Error('Components must be registered before running validator tests');
    }
  });

  // =========================================================================
  // 1. Valid graphs
  // =========================================================================
  describe('valid graphs', () => {
    it('returns isValid=true for a minimal valid graph', () => {
      const result = compileAndValidate(makeMinimalGraph());
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('returns isValid=true for a valid two-node DAG with data edge', () => {
      const graph = makeTwoNodeGraph({ sourceHandle: 'text', targetHandle: 'body' });
      const result = compileAndValidate(graph);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('returns isValid=true for a control-only edge (no handles)', () => {
      const result = compileAndValidate(makeTwoNodeGraph());
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  // =========================================================================
  // 2. Unknown component type
  // =========================================================================
  describe('unknown component type', () => {
    it('reports an error for an unknown component type', () => {
      const graph: WorkflowGraphDto = {
        name: 'Unknown component workflow',
        nodes: [
          {
            id: 'entry',
            type: 'core.workflow.entrypoint',
            position: { x: 0, y: 0 },
            data: {
              label: 'Entry',
              config: { params: { runtimeInputs: [] }, inputOverrides: {} },
            },
          },
          {
            id: 'bad-node',
            type: 'totally.fake.component',
            position: { x: 0, y: 100 },
            data: {
              label: 'Bad Node',
              config: { params: {}, inputOverrides: {} },
            },
          },
        ],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      };

      const result = validateWorkflowGraph(graph, {
        version: 2,
        title: 'Unknown component workflow',
        entrypoint: { ref: 'entry' },
        nodes: {},
        edges: [],
        dependencyCounts: {},
        actions: [],
        config: { environment: 'default', timeoutSeconds: 0 },
        loopBodies: {},
      });

      expect(result.isValid).toBe(false);
      const unknownErr = result.errors.find((e) => e.node === 'bad-node');
      expect(unknownErr).toBeDefined();
      expect(unknownErr!.message).toContain('Unknown component type');
      expect(unknownErr!.message).toContain('totally.fake.component');
      expect(unknownErr!.suggestion).toContain('Available components');
    });
  });

  // =========================================================================
  // 3. Entry point configuration
  // =========================================================================
  describe('entry point configuration', () => {
    it('reports an error when no entry point exists', () => {
      const graph: WorkflowGraphDto = {
        name: 'No entry point',
        nodes: [
          {
            id: 'http',
            type: 'core.http.request',
            position: { x: 0, y: 0 },
            data: {
              label: 'HTTP',
              config: {
                params: { method: 'GET' },
                inputOverrides: { url: 'https://example.com' },
              },
            },
          },
        ],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      };

      // Compiler throws for missing entry point, so build the definition manually
      const compiled = buildDefinition(graph);
      const result = validateWorkflowGraph(graph, compiled);

      expect(result.isValid).toBe(false);
      const entryErr = result.errors.find((e) => e.message.includes('Entry Point is required'));
      expect(entryErr).toBeDefined();
    });

    it('reports an error when multiple entry points exist', () => {
      const graph: WorkflowGraphDto = {
        name: 'Two entry points',
        nodes: [
          {
            id: 'entry1',
            type: 'core.workflow.entrypoint',
            position: { x: 0, y: 0 },
            data: {
              label: 'Entry 1',
              config: { params: { runtimeInputs: [] }, inputOverrides: {} },
            },
          },
          {
            id: 'entry2',
            type: 'core.workflow.entrypoint',
            position: { x: 100, y: 0 },
            data: {
              label: 'Entry 2',
              config: { params: { runtimeInputs: [] }, inputOverrides: {} },
            },
          },
        ],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      };

      // Compiler throws for multiple entry points, so build manually
      const compiled = buildDefinition(graph);
      const result = validateWorkflowGraph(graph, compiled);

      expect(result.isValid).toBe(false);
      const multiErr = result.errors.find((e) =>
        e.message.includes('Only one Entry Point is allowed'),
      );
      expect(multiErr).toBeDefined();
    });

    it('warns when entry point has no runtime inputs', () => {
      const graph = makeMinimalGraph({
        nodes: [
          {
            id: 'entry',
            type: 'core.workflow.entrypoint',
            position: { x: 0, y: 0 },
            data: {
              label: 'Entry',
              config: { params: { runtimeInputs: [] }, inputOverrides: {} },
            },
          },
        ],
      });

      const result = compileAndValidate(graph);

      const warning = result.warnings.find((w) =>
        w.message.includes('no runtime inputs configured'),
      );
      expect(warning).toBeDefined();
      expect(warning!.severity).toBe('warning');
    });

    it('reports an error for runtime input missing required fields', () => {
      const graph = makeMinimalGraph({
        nodes: [
          {
            id: 'entry',
            type: 'core.workflow.entrypoint',
            position: { x: 0, y: 0 },
            data: {
              label: 'Entry',
              config: {
                params: {
                  runtimeInputs: [{ id: '', label: '', type: '' }],
                },
                inputOverrides: {},
              },
            },
          },
        ],
      });

      // Compiler throws on param validation failure, so build manually
      const compiled = buildDefinition(graph);
      const result = validateWorkflowGraph(graph, compiled);

      expect(result.isValid).toBe(false);
      const fieldErr = result.errors.find((e) => e.message.includes('missing required fields'));
      expect(fieldErr).toBeDefined();
    });
  });

  // =========================================================================
  // 4. Edge compatibility / port type checking
  // =========================================================================
  describe('edge compatibility', () => {
    it('reports error when sourceHandle is present but targetHandle is missing', () => {
      const graph = makeTwoNodeGraph({ sourceHandle: 'text', targetHandle: undefined });
      const compiled = buildDefinition(graph);
      const result = validateWorkflowGraph(graph, compiled);

      expect(result.isValid).toBe(false);
      const edgeErr = result.errors.find((e) => e.message.includes('missing targetHandle'));
      expect(edgeErr).toBeDefined();
    });

    it('reports error when targetHandle is present but sourceHandle is missing', () => {
      const graph = makeTwoNodeGraph({ sourceHandle: undefined, targetHandle: 'body' });
      const compiled = buildDefinition(graph);
      const result = validateWorkflowGraph(graph, compiled);

      expect(result.isValid).toBe(false);
      const edgeErr = result.errors.find((e) => e.message.includes('missing sourceHandle'));
      expect(edgeErr).toBeDefined();
    });

    it('reports error when source port does not exist on source node', () => {
      const graph = makeTwoNodeGraph({ sourceHandle: 'nonexistentPort', targetHandle: 'body' });
      const compiled = buildDefinition(graph);
      const result = validateWorkflowGraph(graph, compiled);

      expect(result.isValid).toBe(false);
      const portErr = result.errors.find((e) =>
        e.message.includes("Source port 'nonexistentPort' not found"),
      );
      expect(portErr).toBeDefined();
    });

    it('reports error when target port does not exist on target node', () => {
      const graph = makeTwoNodeGraph({ sourceHandle: 'text', targetHandle: 'nonexistentInput' });
      const compiled = buildDefinition(graph);
      const result = validateWorkflowGraph(graph, compiled);

      expect(result.isValid).toBe(false);
      const portErr = result.errors.find((e) =>
        e.message.includes("Target port 'nonexistentInput' not found"),
      );
      expect(portErr).toBeDefined();
    });

    it('allows control edges (no handles) without errors', () => {
      const result = compileAndValidate(makeTwoNodeGraph());
      expect(result.isValid).toBe(true);
    });
  });

  // =========================================================================
  // 5. Input mapping validation
  // =========================================================================
  describe('input mapping validation', () => {
    it('reports error when edge references unknown source node', () => {
      const graph = makeMinimalGraph();
      const compiled = buildDefinition(graph);

      compiled.actions[0].inputMappings = {
        text: { sourceRef: 'nonexistent_node', sourceHandle: 'output' },
      };

      const result = validateWorkflowGraph(graph, compiled);

      expect(result.isValid).toBe(false);
      const mappingErr = result.errors.find((e) => e.message.includes('unknown source node'));
      expect(mappingErr).toBeDefined();
    });

    it('allows multiple edges to the tools port', () => {
      const graph: WorkflowGraphDto = {
        name: 'Multi-tool workflow',
        nodes: [
          {
            id: 'entry',
            type: 'core.workflow.entrypoint',
            position: { x: 0, y: 0 },
            data: {
              label: 'Entry',
              config: { params: { runtimeInputs: [] }, inputOverrides: {} },
            },
          },
          {
            id: 'tool1',
            type: 'core.http.request',
            position: { x: -50, y: 100 },
            data: {
              label: 'Tool 1',
              config: {
                mode: 'tool',
                params: { method: 'GET' },
                inputOverrides: { url: 'https://tool1.com' },
              },
            },
          },
          {
            id: 'tool2',
            type: 'core.http.request',
            position: { x: 50, y: 100 },
            data: {
              label: 'Tool 2',
              config: {
                mode: 'tool',
                params: { method: 'GET' },
                inputOverrides: { url: 'https://tool2.com' },
              },
            },
          },
          {
            id: 'agent',
            type: 'core.ai.agent',
            position: { x: 0, y: 200 },
            data: {
              label: 'Agent',
              config: { params: {}, inputOverrides: { userInput: 'hello' } },
            },
          },
        ],
        edges: [
          { id: 'e1', source: 'entry', target: 'tool1' },
          { id: 'e2', source: 'entry', target: 'tool2' },
          {
            id: 't1',
            source: 'tool1',
            target: 'agent',
            sourceHandle: 'tools',
            targetHandle: 'tools',
          },
          {
            id: 't2',
            source: 'tool2',
            target: 'agent',
            sourceHandle: 'tools',
            targetHandle: 'tools',
          },
        ],
        viewport: { x: 0, y: 0, zoom: 1 },
      };

      const compiled = compileWorkflowGraph(graph);
      const result = validateWorkflowGraph(graph, compiled);

      const multiEdgeErr = result.errors.find((e) => e.message.includes('Multiple edges detected'));
      expect(multiEdgeErr).toBeUndefined();
    });
  });

  // =========================================================================
  // 6. Result structure
  // =========================================================================
  describe('result structure', () => {
    it('returns separate errors and warnings arrays', () => {
      const result = compileAndValidate(makeMinimalGraph());

      expect(result).toHaveProperty('isValid');
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('warnings');
      expect(Array.isArray(result.errors)).toBe(true);
      expect(Array.isArray(result.warnings)).toBe(true);
    });

    it('each error has node, field, message, and severity', () => {
      const graph = makeMinimalGraph({
        nodes: [
          ...makeMinimalGraph().nodes,
          {
            id: 'unknown',
            type: 'fake.component.xyz',
            position: { x: 100, y: 0 },
            data: {
              label: 'Unknown',
              config: { params: {}, inputOverrides: {} },
            },
          },
        ],
      });

      const compiled = buildDefinition(graph);
      const result = validateWorkflowGraph(graph, compiled);

      expect(result.errors.length).toBeGreaterThan(0);
      for (const error of result.errors) {
        expect(error).toHaveProperty('node');
        expect(error).toHaveProperty('field');
        expect(error).toHaveProperty('message');
        expect(error).toHaveProperty('severity');
        expect(['error', 'warning']).toContain(error.severity);
      }
    });
  });

  // =========================================================================
  // 7. Edge referencing unknown actions
  // =========================================================================
  describe('edge referencing unknown actions', () => {
    it('reports error for edge with missing source/target in compiled definition', () => {
      const graph = makeMinimalGraph();
      const compiled = buildDefinition(graph);

      compiled.edges.push({
        id: 'bad-edge',
        sourceRef: 'ghost_source',
        targetRef: 'ghost_target',
        sourceHandle: 'out',
        targetHandle: 'in',
        kind: 'success',
      });

      const result = validateWorkflowGraph(graph, compiled);

      expect(result.isValid).toBe(false);
      const edgeErr = result.errors.find((e) => e.message.includes('unknown action'));
      expect(edgeErr).toBeDefined();
    });
  });

  // =========================================================================
  // 8. isValid flag semantics
  // =========================================================================
  describe('isValid flag', () => {
    it('is true when errors array is empty', () => {
      const result = compileAndValidate(makeMinimalGraph());
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('is false when there is at least one error', () => {
      const graph = makeMinimalGraph({
        nodes: [
          {
            id: 'entry',
            type: 'core.workflow.entrypoint',
            position: { x: 0, y: 0 },
            data: {
              label: 'Entry',
              config: {
                params: {
                  runtimeInputs: [{ id: '', label: '', type: '' }],
                },
                inputOverrides: {},
              },
            },
          },
        ],
      });

      const compiled = buildDefinition(graph);
      const result = validateWorkflowGraph(graph, compiled);

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('warnings do not affect isValid', () => {
      // Empty runtimeInputs produces a warning but no error
      const graph = makeMinimalGraph({
        nodes: [
          {
            id: 'entry',
            type: 'core.workflow.entrypoint',
            position: { x: 0, y: 0 },
            data: {
              label: 'Entry',
              config: {
                params: { runtimeInputs: [] },
                inputOverrides: {},
              },
            },
          },
        ],
      });

      const result = compileAndValidate(graph);

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.isValid).toBe(true);
    });
  });

  // =========================================================================
  // 9. Complex graph topologies
  // =========================================================================
  describe('complex graph topologies', () => {
    it('validates a diamond graph (converging branches) without errors', () => {
      const graph: WorkflowGraphDto = {
        name: 'Diamond workflow',
        nodes: [
          {
            id: 'start',
            type: 'core.workflow.entrypoint',
            position: { x: 0, y: 0 },
            data: {
              label: 'Start',
              config: {
                params: {
                  runtimeInputs: [{ id: 'seed', label: 'Seed', type: 'text', required: false }],
                },
                inputOverrides: {},
              },
            },
          },
          {
            id: 'branchA',
            type: 'core.http.request',
            position: { x: -100, y: 100 },
            data: {
              label: 'Branch A',
              config: {
                params: { method: 'GET' },
                inputOverrides: { url: 'https://a.com' },
              },
            },
          },
          {
            id: 'branchB',
            type: 'core.http.request',
            position: { x: 100, y: 100 },
            data: {
              label: 'Branch B',
              config: {
                params: { method: 'GET' },
                inputOverrides: { url: 'https://b.com' },
              },
            },
          },
          {
            id: 'merge',
            type: 'core.http.request',
            position: { x: 0, y: 200 },
            data: {
              label: 'Merge',
              config: {
                params: { method: 'POST' },
                inputOverrides: { url: 'https://merge.com' },
              },
            },
          },
        ],
        edges: [
          { id: 'start-a', source: 'start', target: 'branchA' },
          { id: 'start-b', source: 'start', target: 'branchB' },
          { id: 'a-merge', source: 'branchA', target: 'merge' },
          { id: 'b-merge', source: 'branchB', target: 'merge' },
        ],
        viewport: { x: 0, y: 0, zoom: 1 },
      };

      const result = compileAndValidate(graph);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('validates a linear chain of nodes without errors', () => {
      const graph: WorkflowGraphDto = {
        name: 'Linear chain',
        nodes: [
          {
            id: 'entry',
            type: 'core.workflow.entrypoint',
            position: { x: 0, y: 0 },
            data: {
              label: 'Entry',
              config: {
                params: {
                  runtimeInputs: [{ id: 'text', label: 'Text', type: 'text', required: false }],
                },
                inputOverrides: {},
              },
            },
          },
          {
            id: 'step1',
            type: 'core.http.request',
            position: { x: 0, y: 100 },
            data: {
              label: 'Step 1',
              config: {
                params: { method: 'GET' },
                inputOverrides: { url: 'https://step1.com' },
              },
            },
          },
          {
            id: 'step2',
            type: 'core.http.request',
            position: { x: 0, y: 200 },
            data: {
              label: 'Step 2',
              config: {
                params: { method: 'POST' },
                inputOverrides: { url: 'https://step2.com' },
              },
            },
          },
        ],
        edges: [
          { id: 'e1', source: 'entry', target: 'step1' },
          { id: 'e2', source: 'step1', target: 'step2' },
        ],
        viewport: { x: 0, y: 0, zoom: 1 },
      };

      const result = compileAndValidate(graph);

      expect(result.isValid).toBe(true);
    });
  });

  // =========================================================================
  // 10. Type-compatible data edges
  // =========================================================================
  describe('type-compatible data edges', () => {
    it('accepts edge from entry point to file loader (fileId -> fileId)', () => {
      const graph: WorkflowGraphDto = {
        name: 'Compatible edge workflow',
        nodes: [
          {
            id: 'entry',
            type: 'core.workflow.entrypoint',
            position: { x: 0, y: 0 },
            data: {
              label: 'Entry',
              config: {
                params: {
                  runtimeInputs: [{ id: 'fileId', label: 'File ID', type: 'file', required: true }],
                },
                inputOverrides: {},
              },
            },
          },
          {
            id: 'loader',
            type: 'core.file.loader',
            position: { x: 0, y: 100 },
            data: {
              label: 'File Loader',
              config: {
                params: {},
                inputOverrides: { fileId: '11111111-1111-4111-8111-111111111111' },
              },
            },
          },
          {
            id: 'webhook',
            type: 'core.http.request',
            position: { x: 0, y: 200 },
            data: {
              label: 'Webhook',
              config: {
                params: { method: 'POST' },
                inputOverrides: { url: 'https://example.com/webhook' },
              },
            },
          },
        ],
        edges: [
          {
            id: 'e1',
            source: 'entry',
            target: 'loader',
            sourceHandle: 'fileId',
            targetHandle: 'fileId',
          },
          {
            id: 'e2',
            source: 'loader',
            target: 'webhook',
            sourceHandle: 'textContent',
            targetHandle: 'body',
          },
        ],
        viewport: { x: 0, y: 0, zoom: 1 },
      };

      const result = compileAndValidate(graph);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  // =========================================================================
  // 11. Multiple edges to same non-tools port (via buildDefinition)
  // =========================================================================
  describe('duplicate port edges', () => {
    it('reports error when two edges target the same input port', () => {
      const graph: WorkflowGraphDto = {
        name: 'Duplicate port workflow',
        nodes: [
          {
            id: 'entry',
            type: 'core.workflow.entrypoint',
            position: { x: 0, y: 0 },
            data: {
              label: 'Entry',
              config: {
                params: {
                  runtimeInputs: [
                    { id: 'out1', label: 'Out 1', type: 'text', required: false },
                    { id: 'out2', label: 'Out 2', type: 'text', required: false },
                  ],
                },
                inputOverrides: {},
              },
            },
          },
          {
            id: 'target',
            type: 'core.http.request',
            position: { x: 0, y: 200 },
            data: {
              label: 'Target',
              config: {
                params: { method: 'GET' },
                inputOverrides: { url: 'https://example.com' },
              },
            },
          },
        ],
        edges: [
          {
            id: 'e1',
            source: 'entry',
            target: 'target',
            sourceHandle: 'out1',
            targetHandle: 'body',
          },
          {
            id: 'e2',
            source: 'entry',
            target: 'target',
            sourceHandle: 'out2',
            targetHandle: 'body',
          },
        ],
        viewport: { x: 0, y: 0, zoom: 1 },
      };

      const compiled = buildDefinition(graph);
      const result = validateWorkflowGraph(graph, compiled);

      const multiEdgeErr = result.errors.find((e) => e.message.includes('Multiple edges detected'));
      expect(multiEdgeErr).toBeDefined();
    });
  });
});
