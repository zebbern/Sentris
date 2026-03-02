import { describe, it, expect, beforeEach } from 'bun:test';
import { useWorkflowHistoryStore, getTemporalState } from '../workflowHistoryStore';
import type { Node as ReactFlowNode, Edge as ReactFlowEdge } from 'reactflow';
import type { FrontendNodeData } from '@/schemas/node';

// --- Helpers ---

const makeNode = (
  id: string,
  overrides: Partial<ReactFlowNode<FrontendNodeData>> = {},
): ReactFlowNode<FrontendNodeData> => ({
  id,
  type: 'component',
  position: { x: 100, y: 200 },
  data: {
    label: `Node ${id}`,
    componentId: `comp-${id}`,
    componentSlug: `slug-${id}`,
    inputs: {},
    config: { params: {}, inputOverrides: {} },
  } as FrontendNodeData,
  ...overrides,
});

const makeEdge = (
  id: string,
  source: string,
  target: string,
  overrides: Partial<ReactFlowEdge> = {},
): ReactFlowEdge => ({
  id,
  source,
  target,
  ...overrides,
});

describe('workflowHistoryStore', () => {
  beforeEach(() => {
    // Reset both the main store and the temporal (undo/redo) store
    useWorkflowHistoryStore.getState().reset();
    getTemporalState().clear();
  });

  // --- Initial state ---

  it('has empty nodes and edges by default', () => {
    const state = useWorkflowHistoryStore.getState();
    expect(state.nodes).toEqual([]);
    expect(state.edges).toEqual([]);
  });

  it('has empty undo/redo history initially', () => {
    const temporal = getTemporalState();
    expect(temporal.pastStates).toHaveLength(0);
    expect(temporal.futureStates).toHaveLength(0);
  });

  // --- setNodes ---

  it('setNodes() updates nodes without affecting edges', () => {
    const nodes = [makeNode('n1'), makeNode('n2')];
    useWorkflowHistoryStore.getState().setNodes(nodes);

    const state = useWorkflowHistoryStore.getState();
    expect(state.nodes).toHaveLength(2);
    expect(state.nodes[0].id).toBe('n1');
    expect(state.nodes[1].id).toBe('n2');
    expect(state.edges).toEqual([]);
  });

  it('setNodes() deep clones nodes (mutation-safe)', () => {
    const original = [makeNode('n1')];
    useWorkflowHistoryStore.getState().setNodes(original);

    // Mutate the original — store should be unaffected
    original[0].position.x = 9999;
    const stored = useWorkflowHistoryStore.getState().nodes[0];
    expect(stored.position.x).toBe(100);
  });

  // --- setEdges ---

  it('setEdges() updates edges without affecting nodes', () => {
    const edges = [makeEdge('e1', 'n1', 'n2')];
    useWorkflowHistoryStore.getState().setEdges(edges);

    const state = useWorkflowHistoryStore.getState();
    expect(state.edges).toHaveLength(1);
    expect(state.edges[0].id).toBe('e1');
    expect(state.nodes).toEqual([]);
  });

  it('setEdges() deep clones edges (mutation-safe)', () => {
    const original = [makeEdge('e1', 'n1', 'n2', { data: { label: 'original' } })];
    useWorkflowHistoryStore.getState().setEdges(original);

    // Mutate the original — store should be unaffected
    original[0].data!.label = 'mutated';
    const stored = useWorkflowHistoryStore.getState().edges[0];
    expect(stored.data?.label).toBe('original');
  });

  // --- applyChange ---

  it('applyChange() sets both nodes and edges atomically', () => {
    const nodes = [makeNode('n1')];
    const edges = [makeEdge('e1', 'n1', 'n2')];

    useWorkflowHistoryStore.getState().applyChange(nodes, edges);

    const state = useWorkflowHistoryStore.getState();
    expect(state.nodes).toHaveLength(1);
    expect(state.edges).toHaveLength(1);
    expect(state.nodes[0].id).toBe('n1');
    expect(state.edges[0].id).toBe('e1');
  });

  it('applyChange() creates a history entry (enables undo)', () => {
    // First state
    useWorkflowHistoryStore.getState().applyChange([makeNode('n1')], []);

    // Second state — should push first state to past
    useWorkflowHistoryStore.getState().applyChange([makeNode('n1'), makeNode('n2')], []);

    const temporal = getTemporalState();
    expect(temporal.pastStates.length).toBeGreaterThanOrEqual(1);
  });

  // --- Undo ---

  it('undo() restores the previous state', () => {
    // State A: one node
    useWorkflowHistoryStore.getState().applyChange([makeNode('n1')], []);

    // State B: two nodes
    useWorkflowHistoryStore.getState().applyChange([makeNode('n1'), makeNode('n2')], []);

    // Undo → should be back to state A
    getTemporalState().undo();

    const state = useWorkflowHistoryStore.getState();
    expect(state.nodes).toHaveLength(1);
    expect(state.nodes[0].id).toBe('n1');
  });

  it('undo() moves state to futureStates (enables redo)', () => {
    useWorkflowHistoryStore.getState().applyChange([makeNode('n1')], []);
    useWorkflowHistoryStore.getState().applyChange([makeNode('n2')], []);

    getTemporalState().undo();

    const temporal = getTemporalState();
    expect(temporal.futureStates.length).toBeGreaterThanOrEqual(1);
  });

  it('undo() on empty history is a no-op', () => {
    const stateBefore = useWorkflowHistoryStore.getState();
    getTemporalState().undo();
    const stateAfter = useWorkflowHistoryStore.getState();

    expect(stateAfter.nodes).toEqual(stateBefore.nodes);
    expect(stateAfter.edges).toEqual(stateBefore.edges);
  });

  it('multiple undos walk back through history in order', () => {
    useWorkflowHistoryStore.getState().applyChange([makeNode('a')], []);
    useWorkflowHistoryStore.getState().applyChange([makeNode('b')], []);
    useWorkflowHistoryStore.getState().applyChange([makeNode('c')], []);

    getTemporalState().undo(); // back to [b]
    expect(useWorkflowHistoryStore.getState().nodes[0].id).toBe('b');

    getTemporalState().undo(); // back to [a]
    expect(useWorkflowHistoryStore.getState().nodes[0].id).toBe('a');

    getTemporalState().undo(); // back to initial []
    expect(useWorkflowHistoryStore.getState().nodes).toEqual([]);
  });

  // --- Redo ---

  it('redo() restores a previously undone state', () => {
    useWorkflowHistoryStore.getState().applyChange([makeNode('n1')], []);
    useWorkflowHistoryStore.getState().applyChange([makeNode('n1'), makeNode('n2')], []);

    getTemporalState().undo();
    getTemporalState().redo();

    const state = useWorkflowHistoryStore.getState();
    expect(state.nodes).toHaveLength(2);
  });

  it('redo() on empty future is a no-op', () => {
    useWorkflowHistoryStore.getState().applyChange([makeNode('n1')], []);
    const stateBefore = useWorkflowHistoryStore.getState();

    getTemporalState().redo();

    const stateAfter = useWorkflowHistoryStore.getState();
    expect(stateAfter.nodes).toEqual(stateBefore.nodes);
    expect(stateAfter.edges).toEqual(stateBefore.edges);
  });

  it('multiple redo walks forward through future states', () => {
    useWorkflowHistoryStore.getState().applyChange([makeNode('a')], []);
    useWorkflowHistoryStore.getState().applyChange([makeNode('b')], []);
    useWorkflowHistoryStore.getState().applyChange([makeNode('c')], []);

    // Undo all the way back
    getTemporalState().undo();
    getTemporalState().undo();
    getTemporalState().undo();
    expect(useWorkflowHistoryStore.getState().nodes).toEqual([]);

    // Redo forward one at a time
    getTemporalState().redo();
    expect(useWorkflowHistoryStore.getState().nodes[0].id).toBe('a');

    getTemporalState().redo();
    expect(useWorkflowHistoryStore.getState().nodes[0].id).toBe('b');

    getTemporalState().redo();
    expect(useWorkflowHistoryStore.getState().nodes[0].id).toBe('c');
  });

  // --- Redo cleared on new push ---

  it('new applyChange() after undo clears future states', () => {
    useWorkflowHistoryStore.getState().applyChange([makeNode('a')], []);
    useWorkflowHistoryStore.getState().applyChange([makeNode('b')], []);

    getTemporalState().undo(); // back to [a], 'b' in future
    expect(getTemporalState().futureStates.length).toBeGreaterThanOrEqual(1);

    // New change should clear future
    useWorkflowHistoryStore.getState().applyChange([makeNode('x')], []);

    expect(getTemporalState().futureStates).toHaveLength(0);
  });

  // --- clear ---

  it('clear() empties both past and future history', () => {
    useWorkflowHistoryStore.getState().applyChange([makeNode('n1')], []);
    useWorkflowHistoryStore.getState().applyChange([makeNode('n2')], []);
    getTemporalState().undo();

    // Should have entries in both past and future
    expect(getTemporalState().pastStates.length).toBeGreaterThan(0);
    expect(getTemporalState().futureStates.length).toBeGreaterThan(0);

    getTemporalState().clear();

    expect(getTemporalState().pastStates).toHaveLength(0);
    expect(getTemporalState().futureStates).toHaveLength(0);
  });

  it('clear() does not affect the current store state', () => {
    useWorkflowHistoryStore.getState().applyChange([makeNode('n1')], [makeEdge('e1', 'n1', 'n2')]);
    getTemporalState().clear();

    const state = useWorkflowHistoryStore.getState();
    expect(state.nodes).toHaveLength(1);
    expect(state.edges).toHaveLength(1);
  });

  // --- reset ---

  it('reset() returns nodes and edges to initial empty state', () => {
    useWorkflowHistoryStore
      .getState()
      .applyChange([makeNode('n1'), makeNode('n2')], [makeEdge('e1', 'n1', 'n2')]);

    useWorkflowHistoryStore.getState().reset();

    const state = useWorkflowHistoryStore.getState();
    expect(state.nodes).toEqual([]);
    expect(state.edges).toEqual([]);
  });

  // --- History limit ---

  it('history is capped at 50 entries (limit option)', () => {
    // Push 55 distinct states — each with a unique node to bypass equality check
    for (let i = 0; i < 55; i++) {
      useWorkflowHistoryStore
        .getState()
        .applyChange([makeNode(`node-${i}`, { position: { x: i * 10, y: 0 } })], []);
    }

    const temporal = getTemporalState();
    expect(temporal.pastStates.length).toBeLessThanOrEqual(50);
  });

  // --- Equality / dedup ---

  it('does not create duplicate history entry for identical state', () => {
    const nodes = [makeNode('n1')];
    const edges = [makeEdge('e1', 'n1', 'n2')];

    useWorkflowHistoryStore.getState().applyChange(nodes, edges);
    const countAfterFirst = getTemporalState().pastStates.length;

    // Apply same logical state again
    useWorkflowHistoryStore.getState().applyChange([makeNode('n1')], [makeEdge('e1', 'n1', 'n2')]);
    const countAfterDup = getTemporalState().pastStates.length;

    expect(countAfterDup).toBe(countAfterFirst);
  });

  it('treats position rounding differences as equal', () => {
    useWorkflowHistoryStore
      .getState()
      .applyChange([makeNode('n1', { position: { x: 100.4, y: 200.3 } })], []);
    const countAfterFirst = getTemporalState().pastStates.length;

    // Same node with sub-pixel difference (rounds to same value)
    useWorkflowHistoryStore
      .getState()
      .applyChange([makeNode('n1', { position: { x: 100.1, y: 200.4 } })], []);
    const countAfterSecond = getTemporalState().pastStates.length;

    expect(countAfterSecond).toBe(countAfterFirst);
  });

  // --- Edge data cloning ---

  it('handles edges with no data property', () => {
    const edges = [makeEdge('e1', 'n1', 'n2')];
    useWorkflowHistoryStore.getState().setEdges(edges);

    const stored = useWorkflowHistoryStore.getState().edges[0];
    expect(stored.data).toBeUndefined();
  });

  // --- Node data cloning with missing optional fields ---

  it('handles nodes with missing config gracefully', () => {
    const node = makeNode('n1');
    // Simulate a node with undefined config
    (node.data as Record<string, unknown>).config = undefined;

    useWorkflowHistoryStore.getState().setNodes([node]);

    const stored = useWorkflowHistoryStore.getState().nodes[0];
    expect(stored.data.config).toEqual({ params: {}, inputOverrides: {} });
  });

  it('handles nodes with missing inputs gracefully', () => {
    const node = makeNode('n1');
    (node.data as Record<string, unknown>).inputs = undefined;

    useWorkflowHistoryStore.getState().setNodes([node]);

    const stored = useWorkflowHistoryStore.getState().nodes[0];
    expect(stored.data.inputs).toEqual({});
  });

  // --- getTemporalState ---

  it('getTemporalState() returns the temporal store with undo/redo functions', () => {
    const temporal = getTemporalState();
    expect(typeof temporal.undo).toBe('function');
    expect(typeof temporal.redo).toBe('function');
    expect(typeof temporal.clear).toBe('function');
    expect(Array.isArray(temporal.pastStates)).toBe(true);
    expect(Array.isArray(temporal.futureStates)).toBe(true);
  });

  // --- Combined undo/redo with edges ---

  it('undo/redo preserves both nodes and edges', () => {
    const nodesA = [makeNode('n1')];
    const edgesA = [makeEdge('e1', 'n1', 'n2')];
    useWorkflowHistoryStore.getState().applyChange(nodesA, edgesA);

    const nodesB = [makeNode('n1'), makeNode('n2')];
    const edgesB = [makeEdge('e1', 'n1', 'n2'), makeEdge('e2', 'n2', 'n3')];
    useWorkflowHistoryStore.getState().applyChange(nodesB, edgesB);

    // Undo → state A
    getTemporalState().undo();
    let state = useWorkflowHistoryStore.getState();
    expect(state.nodes).toHaveLength(1);
    expect(state.edges).toHaveLength(1);

    // Redo → state B
    getTemporalState().redo();
    state = useWorkflowHistoryStore.getState();
    expect(state.nodes).toHaveLength(2);
    expect(state.edges).toHaveLength(2);
  });
});
