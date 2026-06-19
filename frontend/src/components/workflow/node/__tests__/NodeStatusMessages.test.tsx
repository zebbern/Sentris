import { describe, it, afterEach, expect } from 'bun:test';
import { render, screen, cleanup } from '@testing-library/react';
import type { NodeVisualState } from '@/store/executionTimelineStore';
import type { TimelineEvent } from '@/store/executionTimeline/types';

const { NodeStatusMessages } = await import('../NodeStatusMessages');

function createVisualState(overrides: Partial<NodeVisualState> = {}): NodeVisualState {
  return {
    status: 'idle',
    progress: 0,
    startTime: 0,
    eventCount: 0,
    totalEvents: 0,
    lastEvent: null,
    dataFlow: { input: [], output: [] },
    attempts: 0,
    retryCount: 0,
    ...overrides,
  };
}

function createTimelineEvent(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id: 'evt-1',
    type: 'STARTED',
    message: 'Node execution started',
    timestamp: '2026-03-01T00:00:00Z',
    nodeRef: 'node-1',
    level: 'info',
    data: {},
    visualTime: 0.5,
    offsetMs: 1000,
    ...overrides,
  } as TimelineEvent;
}

describe('NodeStatusMessages', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders timeline last-event type when timeline is active', () => {
    const event = createTimelineEvent({ type: 'STARTED' });
    render(
      <NodeStatusMessages
        isTimelineActive={true}
        visualState={createVisualState({ lastEvent: event })}
        nodeStatus={undefined}
        executionTime={undefined}
        error={undefined}
      />,
    );

    expect(screen.getByText('Last: STARTED')).toBeInTheDocument();
  });

  it('renders timeline event message when present', () => {
    const event = createTimelineEvent({
      type: 'COMPLETED',
      message: 'Scan completed successfully',
    });
    render(
      <NodeStatusMessages
        isTimelineActive={true}
        visualState={createVisualState({ lastEvent: event })}
        nodeStatus={undefined}
        executionTime={undefined}
        error={undefined}
      />,
    );

    expect(screen.getByText('Scan completed successfully')).toBeInTheDocument();
  });

  it('renders nothing for timeline section when no lastEvent', () => {
    const { container } = render(
      <NodeStatusMessages
        isTimelineActive={true}
        visualState={createVisualState({ lastEvent: null })}
        nodeStatus={undefined}
        executionTime={undefined}
        error={undefined}
      />,
    );

    // Should just have the border-t container but no event text
    expect(screen.queryByText(/Last:/)).not.toBeInTheDocument();
    // The outer pt-2 div is still rendered
    expect(container.querySelector('.border-t')).not.toBeNull();
  });

  it('renders success badge with execution time in legacy mode', () => {
    render(
      <NodeStatusMessages
        isTimelineActive={false}
        visualState={createVisualState()}
        nodeStatus="success"
        executionTime={1234}
        error={undefined}
      />,
    );

    expect(screen.getByText('✓ 1234ms')).toBeInTheDocument();
  });

  it('does not render success badge when timeline is active', () => {
    render(
      <NodeStatusMessages
        isTimelineActive={true}
        visualState={createVisualState()}
        nodeStatus="success"
        executionTime={1234}
        error={undefined}
      />,
    );

    expect(screen.queryByText('✓ 1234ms')).not.toBeInTheDocument();
  });

  it('renders error badge with error message in legacy mode', () => {
    render(
      <NodeStatusMessages
        isTimelineActive={false}
        visualState={createVisualState()}
        nodeStatus="error"
        executionTime={undefined}
        error="Connection timeout"
      />,
    );

    expect(screen.getByText('✗ Connection timeout')).toBeInTheDocument();
  });

  it('does not render error badge when timeline is active', () => {
    render(
      <NodeStatusMessages
        isTimelineActive={true}
        visualState={createVisualState()}
        nodeStatus="error"
        executionTime={undefined}
        error="Connection timeout"
      />,
    );

    expect(screen.queryByText('✗ Connection timeout')).not.toBeInTheDocument();
  });

  it('renders nothing when idle with no special status', () => {
    const { container } = render(
      <NodeStatusMessages
        isTimelineActive={false}
        visualState={createVisualState()}
        nodeStatus="idle"
        executionTime={undefined}
        error={undefined}
      />,
    );

    // No badges or event messages should be rendered
    expect(container.textContent).toBe('');
  });

  it('does not render success badge when executionTime is missing', () => {
    render(
      <NodeStatusMessages
        isTimelineActive={false}
        visualState={createVisualState()}
        nodeStatus="success"
        executionTime={undefined}
        error={undefined}
      />,
    );

    expect(screen.queryByText(/✓/)).not.toBeInTheDocument();
  });

  it('does not render error badge when error message is missing', () => {
    render(
      <NodeStatusMessages
        isTimelineActive={false}
        visualState={createVisualState()}
        nodeStatus="error"
        executionTime={undefined}
        error={undefined}
      />,
    );

    expect(screen.queryByText(/✗/)).not.toBeInTheDocument();
  });
});
