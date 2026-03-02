import { describe, it, expect, mock, afterEach, beforeEach } from 'bun:test';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Module mocks (BEFORE import)
// ---------------------------------------------------------------------------

const mockExportText = mock(() => {});
const mockCopy = mock(() => Promise.resolve(true));

mock.module('./useXterm', () => ({
  useXterm: () => ({
    containerRef: { current: document.createElement('div') },
    terminalRef: { current: null },
    fitAddonRef: { current: null },
    isTerminalReady: true,
    isXtermLoaded: true,
    xtermError: null,
    terminalReadyRef: { current: true },
  }),
}));

mock.module('@/hooks/useTimelineTerminalStream', () => ({
  useTimelineTerminalStream: () => ({
    chunks: [],
    isHydrating: false,
    isStreaming: false,
    error: null,
    mode: 'idle',
    exportText: mockExportText,
    isTimelineSync: false,
    isFetchingTimeline: false,
    hasData: false,
  }),
}));

mock.module('@/store/executionTimelineStore', () => {
  const useExecutionTimelineStore = ((selector?: any) => {
    const state = { currentTime: 0 };
    return selector ? selector(state) : state;
  }) as any;
  useExecutionTimelineStore.setState = () => {};
  useExecutionTimelineStore.getState = () => ({ currentTime: 0 });
  useExecutionTimelineStore.subscribe = () => () => {};
  useExecutionTimelineStore.destroy = () => {};
  return { useExecutionTimelineStore };
});

mock.module('@/hooks/useCopyToClipboard', () => ({
  useCopyToClipboard: () => ({
    copy: mockCopy,
    copiedText: null,
  }),
}));

import { NodeTerminalPanel } from '../NodeTerminalPanel';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createDefaultProps(overrides: Partial<Parameters<typeof NodeTerminalPanel>[0]> = {}) {
  return {
    nodeId: 'test-node-1',
    runId: 'run-123',
    onClose: mock(() => {}),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NodeTerminalPanel', () => {
  beforeEach(() => {
    mockExportText.mockReset();
    mockCopy.mockReset();
    mockCopy.mockImplementation(() => Promise.resolve(true));
  });

  afterEach(() => {
    cleanup();
  });

  it('renders with node ID in header', () => {
    render(<NodeTerminalPanel {...createDefaultProps({ nodeId: 'my-node-42' })} />);

    expect(screen.getByText(/my-node-42/)).toBeTruthy();
  });

  it('renders "Live Logs" label in header', () => {
    render(<NodeTerminalPanel {...createDefaultProps()} />);

    expect(screen.getByText(/Live Logs/)).toBeTruthy();
  });

  it('close button fires onClose callback', () => {
    const onClose = mock(() => {});
    render(<NodeTerminalPanel {...createDefaultProps({ onClose })} />);

    const closeButton = screen.getByLabelText('Close terminal panel');
    fireEvent.click(closeButton);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders copy button', () => {
    render(<NodeTerminalPanel {...createDefaultProps()} />);

    expect(screen.getByText('Copy')).toBeTruthy();
  });

  it('renders export button', () => {
    render(<NodeTerminalPanel {...createDefaultProps()} />);

    expect(screen.getByText('Export')).toBeTruthy();
  });

  it('embedded mode applies correct styling', () => {
    const { container } = render(<NodeTerminalPanel {...createDefaultProps({ embedded: true })} />);

    const panel = container.firstElementChild as HTMLElement;
    expect(panel.className).toContain('w-full');
    expect(panel.className).toContain('h-full');
    // Should NOT have the non-embedded border/shadow classes
    expect(panel.className).not.toContain('w-[520px]');
    expect(panel.className).not.toContain('shadow-lg');
  });

  it('non-embedded mode applies border and shadow styling', () => {
    const { container } = render(
      <NodeTerminalPanel {...createDefaultProps({ embedded: false })} />,
    );

    const panel = container.firstElementChild as HTMLElement;
    expect(panel.className).toContain('w-[520px]');
    expect(panel.className).toContain('shadow-lg');
  });

  it('renders idle status when not streaming', () => {
    render(<NodeTerminalPanel {...createDefaultProps()} />);

    expect(screen.getByText('Idle')).toBeTruthy();
  });

  it('copy and export buttons are disabled when no chunks', () => {
    render(<NodeTerminalPanel {...createDefaultProps()} />);

    const copyButton = screen.getByText('Copy').closest('button');
    const exportButton = screen.getByText('Export').closest('button');

    expect(copyButton!.disabled).toBe(true);
    expect(exportButton!.disabled).toBe(true);
  });
});
