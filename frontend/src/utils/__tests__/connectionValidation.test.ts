import { describe, expect, it } from 'bun:test';
import type { Node, Edge, Connection } from '@xyflow/react';
import type { FrontendNodeData } from '@/schemas/node';
import type { ComponentMetadata } from '@/schemas/component';

import { validateConnection } from '../connectionValidation';

// Helpers
function makeNode(
  id: string,
  componentSlug: string,
  overrides: Partial<FrontendNodeData> = {},
): Node<FrontendNodeData> {
  return {
    id,
    type: 'workflow',
    position: { x: 0, y: 0 },
    data: {
      label: id,
      config: { params: {}, inputOverrides: {} },
      componentId: componentSlug,
      componentSlug,
      ...overrides,
    },
  } as Node<FrontendNodeData>;
}

function makeComponent(
  slug: string,
  overrides: Partial<ComponentMetadata> = {},
): ComponentMetadata {
  return {
    id: slug,
    slug,
    name: slug,
    version: '1.0.0',
    type: 'process',
    category: 'core',
    description: '',
    inputs: [],
    outputs: [],
    parameters: [],
    ...overrides,
  } as ComponentMetadata;
}

function makeConnection(
  source: string,
  target: string,
  sourceHandle: string | null = 'output',
  targetHandle: string | null = 'input',
): Connection {
  return { source, target, sourceHandle, targetHandle };
}

function makeEdge(id: string, source: string, target: string, targetHandle = 'input'): Edge {
  return { id, source, target, sourceHandle: 'output', targetHandle } as Edge;
}

const textType = { kind: 'primitive' as const, name: 'text' as const };

const sourceComp = makeComponent('scanner', {
  outputs: [{ id: 'output', label: 'Output', connectionType: textType }],
});
const targetComp = makeComponent('processor', {
  inputs: [{ id: 'input', label: 'Input', connectionType: textType, required: true }],
});

function getComponent(slug: string) {
  if (slug === 'scanner') return sourceComp;
  if (slug === 'processor') return targetComp;
  return null;
}

describe('validateConnection', () => {
  describe('basic validation', () => {
    it('accepts valid connection', () => {
      const nodes = [makeNode('n1', 'scanner'), makeNode('n2', 'processor')];
      const result = validateConnection(makeConnection('n1', 'n2'), nodes, [], getComponent);
      expect(result.isValid).toBe(true);
    });

    it('rejects when source is missing', () => {
      const nodes = [makeNode('n1', 'scanner'), makeNode('n2', 'processor')];
      const result = validateConnection(
        makeConnection(null as unknown as string, 'n2'),
        nodes,
        [],
        getComponent,
      );
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Invalid connection');
    });

    it('rejects self-connection', () => {
      const nodes = [makeNode('n1', 'scanner')];
      const result = validateConnection(makeConnection('n1', 'n1'), nodes, [], getComponent);
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Cannot connect node to itself');
    });

    it('rejects when source node not found', () => {
      const nodes = [makeNode('n2', 'processor')];
      const result = validateConnection(makeConnection('missing', 'n2'), nodes, [], getComponent);
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Source or target node not found');
    });

    it('rejects when target node not found', () => {
      const nodes = [makeNode('n1', 'scanner')];
      const result = validateConnection(makeConnection('n1', 'missing'), nodes, [], getComponent);
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Source or target node not found');
    });
  });

  describe('component metadata', () => {
    it('rejects when source component slug is missing', () => {
      const nodes = [
        makeNode('n1', '', { componentId: undefined, componentSlug: undefined }),
        makeNode('n2', 'processor'),
      ];
      const result = validateConnection(makeConnection('n1', 'n2'), nodes, [], getComponent);
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Source component not found');
    });

    it('rejects when component metadata not found', () => {
      const nodes = [makeNode('n1', 'unknown'), makeNode('n2', 'processor')];
      const result = validateConnection(makeConnection('n1', 'n2'), nodes, [], () => null);
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Component metadata not found');
    });
  });

  describe('handle validation', () => {
    it('rejects when source handle is null', () => {
      const nodes = [makeNode('n1', 'scanner'), makeNode('n2', 'processor')];
      const result = validateConnection(
        makeConnection('n1', 'n2', null, 'input'),
        nodes,
        [],
        getComponent,
      );
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Connection handles not specified');
    });

    it('rejects when port is not found', () => {
      const nodes = [makeNode('n1', 'scanner'), makeNode('n2', 'processor')];
      const result = validateConnection(
        makeConnection('n1', 'n2', 'nonexistent', 'input'),
        nodes,
        [],
        getComponent,
      );
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Source port "nonexistent" not found');
    });
  });

  describe('type compatibility', () => {
    it('rejects incompatible types', () => {
      const contractSrc = makeComponent('contract-src', {
        outputs: [
          { id: 'output', label: 'Out', connectionType: { kind: 'contract', name: 'mcp.tool' } },
        ],
      });
      const numTgt = makeComponent('num-tgt', {
        inputs: [
          { id: 'input', label: 'In', connectionType: { kind: 'primitive', name: 'number' } },
        ],
      });
      const nodes = [makeNode('n1', 'contract-src'), makeNode('n2', 'num-tgt')];
      const result = validateConnection(makeConnection('n1', 'n2'), nodes, [], (slug: string) =>
        slug === 'contract-src' ? contractSrc : slug === 'num-tgt' ? numTgt : null,
      );
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Type mismatch');
    });
  });

  describe('duplicate connections', () => {
    it('rejects when target input already has a connection', () => {
      const nodes = [
        makeNode('n1', 'scanner'),
        makeNode('n2', 'processor'),
        makeNode('n3', 'scanner'),
      ];
      const edges = [makeEdge('e1', 'n1', 'n2', 'input')];
      const result = validateConnection(makeConnection('n3', 'n2'), nodes, edges, getComponent);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('already has a connection');
    });

    it('allows many-to-one for mcp.tool contract ports', () => {
      const toolSrc = makeComponent('tool-src', {
        outputs: [
          { id: 'output', label: 'Out', connectionType: { kind: 'contract', name: 'mcp.tool' } },
        ],
      });
      const agentTgt = makeComponent('agent-tgt', {
        inputs: [
          { id: 'input', label: 'Tools', connectionType: { kind: 'contract', name: 'mcp.tool' } },
        ],
      });
      const nodes = [
        makeNode('n1', 'tool-src'),
        makeNode('n2', 'agent-tgt'),
        makeNode('n3', 'tool-src'),
      ];
      const edges = [makeEdge('e1', 'n1', 'n2', 'input')];
      const result = validateConnection(makeConnection('n3', 'n2'), nodes, edges, (slug: string) =>
        slug === 'tool-src' ? toolSrc : slug === 'agent-tgt' ? agentTgt : null,
      );
      expect(result.isValid).toBe(true);
    });
  });

  describe('cycle detection', () => {
    it('rejects connections that would create a direct cycle', () => {
      const dualComp = makeComponent('dual', {
        inputs: [{ id: 'input', label: 'In', connectionType: textType }],
        outputs: [{ id: 'output', label: 'Out', connectionType: textType }],
      });
      const nodes = [makeNode('n1', 'dual'), makeNode('n2', 'dual')];
      const edges = [makeEdge('e1', 'n1', 'n2')];
      const result = validateConnection(makeConnection('n2', 'n1'), nodes, edges, () => dualComp);
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Connection would create a cycle');
    });

    it('rejects indirect cycles', () => {
      const dualComp = makeComponent('dual', {
        inputs: [{ id: 'input', label: 'In', connectionType: textType }],
        outputs: [{ id: 'output', label: 'Out', connectionType: textType }],
      });
      const nodes = [makeNode('n1', 'dual'), makeNode('n2', 'dual'), makeNode('n3', 'dual')];
      const edges = [makeEdge('e1', 'n1', 'n2'), makeEdge('e2', 'n2', 'n3')];
      const result = validateConnection(makeConnection('n3', 'n1'), nodes, edges, () => dualComp);
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Connection would create a cycle');
    });

    it('allows non-cyclic connections in complex graph', () => {
      const dualComp = makeComponent('dual', {
        inputs: [{ id: 'input', label: 'In', connectionType: textType }],
        outputs: [{ id: 'output', label: 'Out', connectionType: textType }],
      });
      const nodes = 'n1 n2 n3 n4 n5'.split(' ').map((id) => makeNode(id, 'dual'));
      const edges = [
        makeEdge('e1', 'n1', 'n2'),
        makeEdge('e2', 'n2', 'n4'),
        makeEdge('e3', 'n1', 'n3'),
        makeEdge('e4', 'n3', 'n4'),
      ];
      const result = validateConnection(makeConnection('n4', 'n5'), nodes, edges, () => dualComp);
      expect(result.isValid).toBe(true);
    });
  });

  describe('dynamic ports', () => {
    it('validates using dynamicOutputs from node data', () => {
      const src = makeNode('n1', 'scanner', {
        dynamicOutputs: [{ id: 'dyn-out', label: 'Dynamic', connectionType: textType }],
      });
      const tgt = makeNode('n2', 'processor');
      const result = validateConnection(
        makeConnection('n1', 'n2', 'dyn-out', 'input'),
        [src, tgt],
        [],
        getComponent,
      );
      expect(result.isValid).toBe(true);
    });

    it('validates using dynamicInputs from node data', () => {
      const src = makeNode('n1', 'scanner');
      const tgt = makeNode('n2', 'processor', {
        dynamicInputs: [{ id: 'dyn-in', label: 'Dynamic', connectionType: textType }],
      });
      const result = validateConnection(
        makeConnection('n1', 'n2', 'output', 'dyn-in'),
        [src, tgt],
        [],
        getComponent,
      );
      expect(result.isValid).toBe(true);
    });
  });

  describe('tool mode virtual port', () => {
    it('adds virtual tools port when isToolMode is set', () => {
      const agentComp = makeComponent('agent', {
        inputs: [
          { id: 'input', label: 'Tools', connectionType: { kind: 'contract', name: 'mcp.tool' } },
        ],
      });
      const src = makeNode('n1', 'scanner', {
        config: { params: {}, inputOverrides: {}, isToolMode: true },
      });
      const tgt = makeNode('n2', 'agent');
      const result = validateConnection(
        makeConnection('n1', 'n2', 'tools', 'input'),
        [src, tgt],
        [],
        (slug: string) => (slug === 'scanner' ? sourceComp : slug === 'agent' ? agentComp : null),
      );
      expect(result.isValid).toBe(true);
    });
  });
});
