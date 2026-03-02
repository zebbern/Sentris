import { describe, it, afterEach, expect, mock } from 'bun:test';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

// EdgeContextMenu is a pure presentational component — no store/provider mocks needed.
const { EdgeContextMenu } = await import('../EdgeContextMenu');

interface EdgeContextMenuTestProps {
  position: { x: number; y: number };
  edgeId: string;
  isDesignMode: boolean;
  onClose: () => void;
  onDelete: (edgeId: string) => void;
  onInsertNode: (edgeId: string) => void;
  onHighlightPath: (edgeId: string) => void;
}

function createDefaultProps(
  overrides: Partial<EdgeContextMenuTestProps> = {},
): EdgeContextMenuTestProps {
  return {
    position: { x: 100, y: 200 },
    edgeId: 'edge-1',
    isDesignMode: true,
    onClose: mock(() => {}),
    onDelete: mock(() => {}),
    onInsertNode: mock(() => {}),
    onHighlightPath: mock(() => {}),
    ...overrides,
  };
}

describe('EdgeContextMenu', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders at the specified position', () => {
    const props = createDefaultProps();
    render(<EdgeContextMenu {...props} />);

    const menu = screen.getByRole('menu');
    expect(menu).toBeInTheDocument();
    expect(menu.style.left).toBe('100px');
    expect(menu.style.top).toBe('200px');
  });

  it('renders all menu items in design mode', () => {
    const props = createDefaultProps({ isDesignMode: true });
    render(<EdgeContextMenu {...props} />);

    expect(screen.getByText('Delete Edge')).toBeInTheDocument();
    expect(screen.getByText('Insert Node Here')).toBeInTheDocument();
    expect(screen.getByText('Highlight Path')).toBeInTheDocument();
  });

  it('hides design-only items when not in design mode', () => {
    const props = createDefaultProps({ isDesignMode: false });
    render(<EdgeContextMenu {...props} />);

    expect(screen.queryByText('Delete Edge')).not.toBeInTheDocument();
    expect(screen.queryByText('Insert Node Here')).not.toBeInTheDocument();
    // Highlight Path is always visible
    expect(screen.getByText('Highlight Path')).toBeInTheDocument();
  });

  it('fires onDelete callback with edgeId when Delete Edge is clicked', () => {
    const props = createDefaultProps();
    render(<EdgeContextMenu {...props} />);

    fireEvent.click(screen.getByText('Delete Edge'));
    expect(props.onDelete).toHaveBeenCalledWith('edge-1');
    expect(props.onClose).toHaveBeenCalled();
  });

  it('fires onInsertNode callback with edgeId when Insert Node Here is clicked', () => {
    const props = createDefaultProps();
    render(<EdgeContextMenu {...props} />);

    fireEvent.click(screen.getByText('Insert Node Here'));
    expect(props.onInsertNode).toHaveBeenCalledWith('edge-1');
    expect(props.onClose).toHaveBeenCalled();
  });

  it('fires onHighlightPath callback with edgeId when Highlight Path is clicked', () => {
    const props = createDefaultProps();
    render(<EdgeContextMenu {...props} />);

    fireEvent.click(screen.getByText('Highlight Path'));
    expect(props.onHighlightPath).toHaveBeenCalledWith('edge-1');
    expect(props.onClose).toHaveBeenCalled();
  });

  it('has correct ARIA attributes', () => {
    const props = createDefaultProps();
    render(<EdgeContextMenu {...props} />);

    const menu = screen.getByRole('menu');
    expect(menu).toHaveAttribute('aria-label', 'Edge context menu');
    expect(menu).toHaveAttribute('tabindex', '-1');

    const menuItems = screen.getAllByRole('menuitem');
    expect(menuItems.length).toBe(3); // Delete, Insert, Highlight
  });

  it('only renders one menu item when not in design mode', () => {
    const props = createDefaultProps({ isDesignMode: false });
    render(<EdgeContextMenu {...props} />);

    const menuItems = screen.getAllByRole('menuitem');
    expect(menuItems.length).toBe(1); // Only Highlight Path
  });
});
