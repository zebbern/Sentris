import { describe, it, expect, afterEach } from 'bun:test';
import { render, cleanup } from '@testing-library/react';
import { WorkflowPreview } from '../WorkflowPreview';

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockGraph(nodeCount: number, edgeSpec: [number, number][] = []) {
  const nodes = Array.from({ length: nodeCount }, (_, i) => ({
    id: `node-${i}`,
    type: 'component',
    position: { x: i * 200, y: 0 },
    data: { label: `Node ${i}`, componentSlug: i === 0 ? 'core.workflow.entrypoint' : `step-${i}` },
  }));

  const edges = edgeSpec.map(([source, target]) => ({
    id: `edge-${source}-${target}`,
    source: `node-${source}`,
    target: `node-${target}`,
  }));

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkflowPreview', () => {
  it('renders SVG with correct number of node groups from mock graph', () => {
    const graph = createMockGraph(3, [
      [0, 1],
      [1, 2],
    ]);
    const { container } = render(<WorkflowPreview graph={graph} />);

    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();

    // Each node is rendered as a <g> group with filter
    const nodeGroups = container.querySelectorAll('g[filter]');
    expect(nodeGroups.length).toBe(3);
  });

  it('renders edges between connected nodes', () => {
    const graph = createMockGraph(3, [
      [0, 1],
      [1, 2],
    ]);
    const { container } = render(<WorkflowPreview graph={graph} />);

    // Each edge is a <path> with fill="none" and markerEnd
    const edgePaths = container.querySelectorAll('path[marker-end]');
    expect(edgePaths.length).toBe(2);
  });

  it('handles empty graph gracefully (no nodes)', () => {
    const graph = { nodes: [], edges: [] };
    const { container } = render(<WorkflowPreview graph={graph} />);

    // Should render nothing when there are no non-terminal nodes
    const svg = container.querySelector('svg');
    expect(svg).toBeNull();
  });

  it('handles undefined graph gracefully', () => {
    const { container } = render(<WorkflowPreview />);

    const svg = container.querySelector('svg');
    expect(svg).toBeNull();
  });

  it('className prop is applied to the SVG element', () => {
    const graph = createMockGraph(2, [[0, 1]]);
    const { container } = render(
      <WorkflowPreview graph={graph} className="custom-preview-class" />,
    );

    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg!.getAttribute('class')).toContain('custom-preview-class');
  });

  it('renders node labels as text elements', () => {
    const graph = createMockGraph(2, [[0, 1]]);
    const { container } = render(<WorkflowPreview graph={graph} />);

    const textElements = container.querySelectorAll('text');
    // Each node has two text elements: label + "component" subtitle
    expect(textElements.length).toBe(4); // 2 nodes × 2 texts each
  });

  it('filters out terminal-type nodes', () => {
    const graph = {
      nodes: [
        { id: 'n1', type: 'component', position: { x: 0, y: 0 }, data: { label: 'Step 1' } },
        { id: 'n2', type: 'terminal', position: { x: 200, y: 0 }, data: { label: 'Terminal' } },
        { id: 'n3', type: 'component', position: { x: 400, y: 0 }, data: { label: 'Step 2' } },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n3' }],
    };

    const { container } = render(<WorkflowPreview graph={graph} />);

    // Only 2 non-terminal nodes should render
    const nodeGroups = container.querySelectorAll('g[filter]');
    expect(nodeGroups.length).toBe(2);
  });

  it('renders entry point nodes with pill-shaped corners (rx=20)', () => {
    const graph = createMockGraph(2, [[0, 1]]);
    const { container } = render(<WorkflowPreview graph={graph} />);

    // First node is entry point — its rect should have rx=20
    const rects = container.querySelectorAll('rect[rx="20"]');
    expect(rects.length).toBeGreaterThan(0);
  });

  it('renders port dots on nodes', () => {
    const graph = createMockGraph(2, [[0, 1]]);
    const { container } = render(<WorkflowPreview graph={graph} />);

    // Each node has at least one port dot (circle)
    const circles = container.querySelectorAll('circle');
    // Entry node has 1 icon circle + 1 right port = 2
    // Non-entry node has 1 icon circle + 2 ports = 3
    // Total: at least 5
    expect(circles.length).toBeGreaterThanOrEqual(4);
  });
});
