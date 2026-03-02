import { describe, expect, it } from 'bun:test';
import type { Node, Edge } from 'reactflow';
import type { FrontendNodeData } from '@/schemas/node';

import { getGraphChangeDescription } from '../graphDiff';

// Helpers
function makeNode(
  id: string,
  label: string,
  position = { x: 0, y: 0 },
  data: Partial<FrontendNodeData> = {},
): Node<FrontendNodeData> {
  return {
    id,
    type: 'workflow',
    position,
    data: {
      label,
      config: { params: {}, inputOverrides: {} },
      ...data,
    },
  } as Node<FrontendNodeData>;
}

function makeEdge(id: string, source: string, target: string): Edge {
  return { id, source, target } as Edge;
}

describe('getGraphChangeDescription', () => {
  describe('edge cases', () => {
    it('returns "No state" when both prev and next are falsy', () => {
      expect(getGraphChangeDescription(null as any, null as any)).toBe('No state');
    });

    it('returns "Initial state" when prev has no nodes', () => {
      expect(getGraphChangeDescription({}, { nodes: [], edges: [] })).toBe('Initial state');
    });

    it('returns "State cleared" when next has no nodes', () => {
      expect(getGraphChangeDescription({ nodes: [], edges: [] }, {})).toBe('State cleared');
    });

    it('returns "No visible changes" when both states are identical', () => {
      const state = {
        nodes: [makeNode('n1', 'Node 1')],
        edges: [makeEdge('e1', 'n1', 'n2')],
      };
      expect(getGraphChangeDescription(state, state)).toBe('No visible changes');
    });
  });

  describe('node additions', () => {
    it('describes single node addition with label', () => {
      const prev = { nodes: [], edges: [] };
      const next = { nodes: [makeNode('n1', 'Scanner')], edges: [] };
      expect(getGraphChangeDescription(prev, next)).toBe('Added node "Scanner"');
    });

    it('describes multiple node additions with count', () => {
      const prev = { nodes: [], edges: [] };
      const next = {
        nodes: [makeNode('n1', 'A'), makeNode('n2', 'B'), makeNode('n3', 'C')],
        edges: [],
      };
      expect(getGraphChangeDescription(prev, next)).toBe('Added 3 nodes');
    });

    it('falls back to node ID when label is missing', () => {
      const prev = { nodes: [], edges: [] };
      const next = { nodes: [makeNode('n1', '')], edges: [] };
      expect(getGraphChangeDescription(prev, next)).toBe('Added node "n1"');
    });
  });

  describe('node removals', () => {
    it('describes single node removal with label', () => {
      const prev = { nodes: [makeNode('n1', 'Processor')], edges: [] };
      const next = { nodes: [], edges: [] };
      expect(getGraphChangeDescription(prev, next)).toBe('Deleted node "Processor"');
    });

    it('describes multiple node removals with count', () => {
      const prev = {
        nodes: [makeNode('n1', 'A'), makeNode('n2', 'B')],
        edges: [],
      };
      const next = { nodes: [], edges: [] };
      expect(getGraphChangeDescription(prev, next)).toBe('Deleted 2 nodes');
    });
  });

  describe('node modifications', () => {
    it('detects position change (move)', () => {
      const prev = { nodes: [makeNode('n1', 'Scanner', { x: 0, y: 0 })], edges: [] };
      const next = { nodes: [makeNode('n1', 'Scanner', { x: 100, y: 200 })], edges: [] };
      expect(getGraphChangeDescription(prev, next)).toBe('Moved node "Scanner"');
    });

    it('detects config change (data update)', () => {
      const prev = {
        nodes: [makeNode('n1', 'Scanner', { x: 0, y: 0 }, { status: 'idle' })],
        edges: [],
      };
      const next = {
        nodes: [makeNode('n1', 'Scanner', { x: 0, y: 0 }, { status: 'running' })],
        edges: [],
      };
      expect(getGraphChangeDescription(prev, next)).toBe('Updated config for "Scanner"');
    });

    it('detects combined move and config change', () => {
      const prev = {
        nodes: [makeNode('n1', 'Scanner', { x: 0, y: 0 }, { status: 'idle' })],
        edges: [],
      };
      const next = {
        nodes: [makeNode('n1', 'Scanner', { x: 100, y: 0 }, { status: 'running' })],
        edges: [],
      };
      const result = getGraphChangeDescription(prev, next);
      expect(result).toContain('Moved node "Scanner"');
      expect(result).toContain('Updated config for "Scanner"');
    });

    it('describes multiple node moves', () => {
      const prev = {
        nodes: [makeNode('n1', 'A', { x: 0, y: 0 }), makeNode('n2', 'B', { x: 0, y: 0 })],
        edges: [],
      };
      const next = {
        nodes: [makeNode('n1', 'A', { x: 100, y: 0 }), makeNode('n2', 'B', { x: 0, y: 100 })],
        edges: [],
      };
      expect(getGraphChangeDescription(prev, next)).toBe('Moved 2 nodes');
    });

    it('ignores sub-pixel position differences (rounds before comparison)', () => {
      const prev = { nodes: [makeNode('n1', 'A', { x: 10.3, y: 20.7 })], edges: [] };
      const next = { nodes: [makeNode('n1', 'A', { x: 10.4, y: 20.6 })], edges: [] };
      // Math.round(10.3)=10, Math.round(10.4)=10 — same → no move. Same for y.
      expect(getGraphChangeDescription(prev, next)).toBe('No visible changes');
    });
  });

  describe('edge changes', () => {
    it('describes added connections', () => {
      const prev = { nodes: [makeNode('n1', 'A')], edges: [] };
      const next = {
        nodes: [makeNode('n1', 'A')],
        edges: [makeEdge('e1', 'n1', 'n2')],
      };
      expect(getGraphChangeDescription(prev, next)).toBe('Added 1 connection(s)');
    });

    it('describes removed connections', () => {
      const prev = {
        nodes: [makeNode('n1', 'A')],
        edges: [makeEdge('e1', 'n1', 'n2'), makeEdge('e2', 'n2', 'n3')],
      };
      const next = {
        nodes: [makeNode('n1', 'A')],
        edges: [],
      };
      expect(getGraphChangeDescription(prev, next)).toBe('Removed 2 connection(s)');
    });
  });

  describe('combined changes', () => {
    it('lists all change types in a single description', () => {
      const prev = {
        nodes: [makeNode('n1', 'A', { x: 0, y: 0 })],
        edges: [makeEdge('e1', 'n1', 'n2')],
      };
      const next = {
        nodes: [makeNode('n1', 'A', { x: 50, y: 50 }), makeNode('n2', 'B')],
        edges: [],
      };
      const result = getGraphChangeDescription(prev, next);
      expect(result).toContain('Added node "B"');
      expect(result).toContain('Moved node "A"');
      expect(result).toContain('Removed 1 connection(s)');
    });
  });
});

describe('areObjectsEqual (via getGraphChangeDescription)', () => {
  // areObjectsEqual is not exported, but we test it indirectly through config change detection
  it('detects nested object changes in node data', () => {
    const prev = {
      nodes: [
        makeNode(
          'n1',
          'A',
          { x: 0, y: 0 },
          {
            config: { params: { key: 'old' }, inputOverrides: {} },
          },
        ),
      ],
      edges: [],
    };
    const next = {
      nodes: [
        makeNode(
          'n1',
          'A',
          { x: 0, y: 0 },
          {
            config: { params: { key: 'new' }, inputOverrides: {} },
          },
        ),
      ],
      edges: [],
    };
    expect(getGraphChangeDescription(prev, next)).toBe('Updated config for "A"');
  });

  it('detects array length changes in node data', () => {
    const prev = {
      nodes: [
        makeNode(
          'n1',
          'A',
          { x: 0, y: 0 },
          {
            config: { params: { items: [1, 2] }, inputOverrides: {} },
          },
        ),
      ],
      edges: [],
    };
    const next = {
      nodes: [
        makeNode(
          'n1',
          'A',
          { x: 0, y: 0 },
          {
            config: { params: { items: [1, 2, 3] }, inputOverrides: {} },
          },
        ),
      ],
      edges: [],
    };
    expect(getGraphChangeDescription(prev, next)).toBe('Updated config for "A"');
  });
});
