import { describe, expect, it } from 'bun:test';
import type { Edge } from '@xyflow/react';

import { findFullPath, findFullPathNodes } from '../graphTraversal';

// Helpers
function edge(id: string, source: string, target: string): Edge {
  return { id, source, target } as Edge;
}

describe('findFullPath', () => {
  it('returns empty set when startEdgeId is not found', () => {
    const edges = [edge('e1', 'a', 'b')];
    expect(findFullPath(edges, 'nonexistent').size).toBe(0);
  });

  it('returns empty set for empty edges array', () => {
    expect(findFullPath([], 'e1').size).toBe(0);
  });

  it('returns only the start edge for a single-edge graph', () => {
    const edges = [edge('e1', 'a', 'b')];
    const result = findFullPath(edges, 'e1');
    expect(result).toEqual(new Set(['e1']));
  });

  it('traverses a simple linear chain downstream', () => {
    // a -> b -> c -> d
    const edges = [edge('e1', 'a', 'b'), edge('e2', 'b', 'c'), edge('e3', 'c', 'd')];
    const result = findFullPath(edges, 'e1');
    expect(result).toEqual(new Set(['e1', 'e2', 'e3']));
  });

  it('traverses a simple linear chain upstream', () => {
    // a -> b -> c -> d  (start from e3)
    const edges = [edge('e1', 'a', 'b'), edge('e2', 'b', 'c'), edge('e3', 'c', 'd')];
    const result = findFullPath(edges, 'e3');
    expect(result).toEqual(new Set(['e1', 'e2', 'e3']));
  });

  it('traverses both upstream and downstream from a middle edge', () => {
    // a -> b -> c -> d
    const edges = [edge('e1', 'a', 'b'), edge('e2', 'b', 'c'), edge('e3', 'c', 'd')];
    const result = findFullPath(edges, 'e2');
    expect(result).toEqual(new Set(['e1', 'e2', 'e3']));
  });

  it('handles branching graphs (one source, multiple targets)', () => {
    //     b
    //    /
    // a -
    //    \
    //     c -> d
    const edges = [edge('e1', 'a', 'b'), edge('e2', 'a', 'c'), edge('e3', 'c', 'd')];
    const result = findFullPath(edges, 'e1');
    // Start edge is e1 (a->b). Downstream from b: nothing. Upstream from a: nothing (a is root).
    // But a also has e2, which is an outgoing edge — BFS downstream should find it.
    expect(result.has('e1')).toBe(true);
    // e2 is also outgoing from 'a', but upstream BFS starts at 'a' (source of start edge).
    // Since 'a' has no incoming edges, upstream stops. But downstream BFS starts from 'b' (target of start edge).
    // 'b' has no outgoing edges, so downstream stops.
    // So the path is only e1.
    // Wait — let me re-read the code. The function does:
    //   1. BFS downstream from startEdge.target (b) — no outgoing from b → only e1
    //   2. BFS upstream from startEdge.source (a) — no incoming to a → nothing added
    // So result = {e1}
    expect(result).toEqual(new Set(['e1']));
  });

  it('handles merging graphs (multiple sources, one target)', () => {
    // a -> c
    // b -> c -> d
    const edges = [edge('e1', 'a', 'c'), edge('e2', 'b', 'c'), edge('e3', 'c', 'd')];
    const result = findFullPath(edges, 'e1');
    // Start: e1 (a->c). Downstream from c: e3. Upstream from a: nothing.
    // e2 (b->c) is incoming to c, but upstream BFS only goes from a, not from c.
    expect(result).toEqual(new Set(['e1', 'e3']));
  });

  it('handles cycles without infinite loop', () => {
    // a -> b -> c -> a (cycle)
    const edges = [edge('e1', 'a', 'b'), edge('e2', 'b', 'c'), edge('e3', 'c', 'a')];
    const result = findFullPath(edges, 'e1');
    // Downstream from b: e2 (b->c), then e3 (c->a), then from a: e1 again but a is already visited.
    // Upstream from a: e3 (c->a), then from c: e2 (b->c), then from b: e1 (a->b) but a is already visited.
    // Actually the visited set prevents re-visiting. Let me trace:
    // pathEdgeIds = {e1}
    // Downstream from b: visitedNodes = {b}
    //   outgoing from b: e2 (b->c) → add e2, visit c, queue c
    //   outgoing from c: e3 (c->a) → add e3, visit a, queue a
    //   But wait — a is visited? Let's check: visitedNodes starts with {startEdge.target = b},
    //   then adds c, then a. Then outgoing from a: e1 (a->b), but b is already visited. Done.
    //   Actually, the upstream BFS also adds startEdge.source to visitedNodes — but that happens after downstream.
    //   Let me re-read: upstream starts after downstream completes. visitedNodes already has {b, c, a}.
    //   Then visitedNodes.add(startEdge.source = a) — already there. upstreamQueue = [a].
    //   incoming to a: e3 (c->a). e3 already in pathEdgeIds. c is already visited. Done.
    expect(result).toEqual(new Set(['e1', 'e2', 'e3']));
  });

  it('does not include edges from disconnected subgraphs', () => {
    // Graph 1: a -> b
    // Graph 2: c -> d (disconnected)
    const edges = [edge('e1', 'a', 'b'), edge('e2', 'c', 'd')];
    const result = findFullPath(edges, 'e1');
    expect(result).toEqual(new Set(['e1']));
  });

  it('handles diamond-shaped graph', () => {
    //   b
    //  / \
    // a   d
    //  \ /
    //   c
    const edges = [
      edge('e1', 'a', 'b'),
      edge('e2', 'a', 'c'),
      edge('e3', 'b', 'd'),
      edge('e4', 'c', 'd'),
    ];
    const result = findFullPath(edges, 'e1');
    // Start: e1 (a->b). Downstream from b: e3 (b->d). From d: no outgoing.
    // Upstream from a: no incoming.
    // e2 and e4 are NOT included because they're on a different branch from a->c->d.
    expect(result).toEqual(new Set(['e1', 'e3']));
  });

  it('handles complex graph with multiple paths starting from middle', () => {
    // a -> b -> d
    // a -> c -> d -> e
    const edges = [
      edge('e1', 'a', 'b'),
      edge('e2', 'a', 'c'),
      edge('e3', 'b', 'd'),
      edge('e4', 'c', 'd'),
      edge('e5', 'd', 'e'),
    ];
    const result = findFullPath(edges, 'e3');
    // Start: e3 (b->d). Downstream from d: e5 (d->e). Upstream from b: e1 (a->b).
    // From a: no incoming. So result = {e3, e5, e1}.
    expect(result).toEqual(new Set(['e1', 'e3', 'e5']));
  });
});

describe('findFullPathNodes', () => {
  it('returns empty set when startEdgeId is not found', () => {
    const edges = [edge('e1', 'a', 'b')];
    expect(findFullPathNodes(edges, 'nonexistent').size).toBe(0);
  });

  it('returns source and target nodes for a single edge', () => {
    const edges = [edge('e1', 'a', 'b')];
    const result = findFullPathNodes(edges, 'e1');
    expect(result).toEqual(new Set(['a', 'b']));
  });

  it('returns all nodes on the connected path', () => {
    const edges = [edge('e1', 'a', 'b'), edge('e2', 'b', 'c'), edge('e3', 'c', 'd')];
    const result = findFullPathNodes(edges, 'e2');
    expect(result).toEqual(new Set(['a', 'b', 'c', 'd']));
  });

  it('excludes nodes from disconnected subgraphs', () => {
    const edges = [edge('e1', 'a', 'b'), edge('e2', 'c', 'd')];
    const result = findFullPathNodes(edges, 'e1');
    expect(result).toEqual(new Set(['a', 'b']));
  });
});
