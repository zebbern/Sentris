import { describe, it, expect, afterEach, mock } from 'bun:test';
import { renderHook, cleanup } from '@testing-library/react';
import type { Node, Edge } from '@xyflow/react';
import { useCanvasKeyboardShortcuts } from '../useCanvasKeyboardShortcuts';
import type { FrontendNodeData } from '@/schemas/node';

afterEach(cleanup);

/** Dispatch a keydown event from a real DOM element so `event.target.closest` works. */
function dispatchKey(key: string, el: HTMLElement = document.body) {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

function createNode(
  id: string,
  selected = false,
  data: Record<string, unknown> = {},
): Node<FrontendNodeData> {
  return {
    id,
    position: { x: 0, y: 0 },
    data: { label: '', config: { params: {}, inputOverrides: {} }, ...data } as FrontendNodeData,
    selected,
  };
}

function createEdge(id: string, source: string, target: string, selected = false): Edge {
  return { id, source, target, selected };
}

function createOptions(overrides: Partial<Parameters<typeof useCanvasKeyboardShortcuts>[0]> = {}) {
  return {
    nodes: overrides.nodes ?? [],
    edges: overrides.edges ?? [],
    setNodes: overrides.setNodes ?? mock(),
    setEdges: overrides.setEdges ?? mock(),
    setSelectedNode: overrides.setSelectedNode ?? mock(),
    markDirty: overrides.markDirty ?? mock(),
    mode: overrides.mode ?? 'design',
    onSnapshot: overrides.onSnapshot ?? mock(),
    toast: overrides.toast ?? mock(),
  };
}

describe('useCanvasKeyboardShortcuts', () => {
  it('registers keydown listener on mount', () => {
    const addSpy = mock();
    const originalAdd = document.addEventListener;
    document.addEventListener = addSpy;

    renderHook(() => useCanvasKeyboardShortcuts(createOptions()));

    const keydownCalls = addSpy.mock.calls.filter((call: any[]) => call[0] === 'keydown');
    expect(keydownCalls.length).toBeGreaterThan(0);

    document.addEventListener = originalAdd;
  });

  it('removes keydown listener on unmount', () => {
    const removeSpy = mock();
    const originalRemove = document.removeEventListener;
    document.removeEventListener = removeSpy;

    const { unmount } = renderHook(() => useCanvasKeyboardShortcuts(createOptions()));

    unmount();

    const keydownCalls = removeSpy.mock.calls.filter((call: any[]) => call[0] === 'keydown');
    expect(keydownCalls.length).toBeGreaterThan(0);

    document.removeEventListener = originalRemove;
  });

  it('Escape key deselects the current node', () => {
    const setSelectedNode = mock();
    renderHook(() => useCanvasKeyboardShortcuts(createOptions({ setSelectedNode })));

    dispatchKey('Escape');

    expect(setSelectedNode).toHaveBeenCalledWith(null);
  });

  it('Delete key removes selected nodes and edges', () => {
    const setNodes = mock();
    const setEdges = mock();
    const markDirty = mock();
    const onSnapshot = mock();

    const nodes = [createNode('n1', true), createNode('n2', false)];
    const edges = [createEdge('e1', 'n1', 'n2')];

    renderHook(() =>
      useCanvasKeyboardShortcuts(
        createOptions({ nodes, edges, setNodes, setEdges, markDirty, onSnapshot }),
      ),
    );

    dispatchKey('Delete');

    expect(setNodes).toHaveBeenCalled();
    expect(setEdges).toHaveBeenCalled();
    expect(markDirty).toHaveBeenCalled();
    expect(onSnapshot).toHaveBeenCalled();
  });

  it('does nothing when mode is not "design"', () => {
    const setSelectedNode = mock();
    renderHook(() =>
      useCanvasKeyboardShortcuts(createOptions({ mode: 'execute', setSelectedNode })),
    );

    dispatchKey('Escape');

    expect(setSelectedNode).not.toHaveBeenCalled();
  });

  it('ignores keyboard events from input elements', () => {
    const setSelectedNode = mock();
    renderHook(() => useCanvasKeyboardShortcuts(createOptions({ setSelectedNode })));

    const input = document.createElement('input');
    document.body.appendChild(input);

    dispatchKey('Escape', input);

    expect(setSelectedNode).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it('Backspace key also triggers deletion', () => {
    const markDirty = mock();
    const nodes = [createNode('n1', true)];

    renderHook(() => useCanvasKeyboardShortcuts(createOptions({ nodes, markDirty })));

    dispatchKey('Backspace');

    expect(markDirty).toHaveBeenCalled();
  });

  it('prevents deleting all entry point nodes', () => {
    const toastMock = mock();
    const nodes = [createNode('n1', true, { componentId: 'core.workflow.entrypoint' })];

    renderHook(() => useCanvasKeyboardShortcuts(createOptions({ nodes, toast: toastMock })));

    dispatchKey('Delete');

    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Entry Point required',
        variant: 'destructive',
      }),
    );
  });
});
