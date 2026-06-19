import { describe, it, expect, afterEach, mock } from 'bun:test';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { EventCardProps } from '../types';
import type { TimelineEvent } from '@/store/executionTimelineStore';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

mock.module('@/components/workflow/ExecutionErrorView', () => ({
  ExecutionErrorView: ({ error }: any) => <div data-testid="error-view">{error?.message}</div>,
}));

mock.module('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: any) => <>{children}</>,
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ children }: any) => <>{children}</>,
  TooltipContent: ({ children }: any) => <div>{children}</div>,
}));

mock.module('@/utils/textPreview', () => ({
  createPreview: (_text: string, _opts?: any) => ({
    text: _text?.substring(0, 220) ?? '',
    truncated: (_text?.length ?? 0) > 220,
  }),
}));

import { EventCard } from '../EventCard';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id: 'evt-1',
    runId: 'run-1',
    nodeId: 'node-1',
    type: 'PROGRESS',
    level: 'info',
    timestamp: '2026-01-01T00:00:05.123Z',
    message: 'Processing data...',
    visualTime: 0.5,
    offsetMs: 5000,
    ...overrides,
  };
}

function makeProps(overrides: Partial<EventCardProps> = {}): EventCardProps {
  return {
    event: makeEvent(),
    isExpanded: false,
    isSelected: false,
    isCurrent: false,
    isRecentLiveEvent: false,
    isCurrentReplayEvent: false,
    layoutVariant: 'stacked-soft',
    nodeState: undefined,
    relatedFlows: [],
    onToggle: mock(() => {}),
    onOpenFullMessage: mock(() => {}),
    onOpenDiagnostics: mock(() => {}),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EventCard', () => {
  afterEach(cleanup);

  it('renders event type and level badge', () => {
    render(
      <ul>
        <EventCard {...makeProps()} />
      </ul>,
    );

    expect(screen.getByText('PROGRESS')).toBeTruthy();
    expect(screen.getByText('info')).toBeTruthy();
  });

  it('renders message preview text', () => {
    render(
      <ul>
        <EventCard {...makeProps({ event: makeEvent({ message: 'Hello world' }) })} />
      </ul>,
    );

    expect(screen.getByText('Hello world')).toBeTruthy();
  });

  it('shows expanded payload when isExpanded is true', () => {
    const event = makeEvent({
      data: { activatedPorts: ['out'] } as any,
    });
    render(
      <ul>
        <EventCard {...makeProps({ event, isExpanded: true })} />
      </ul>,
    );

    // When expanded, the payload section is rendered
    expect(screen.getByText('Payload')).toBeTruthy();
  });

  it('calls onToggle when clickable area is clicked', () => {
    const onToggle = mock(() => {});
    const event = makeEvent({ data: { activatedPorts: ['out'] } as any });
    render(
      <ul>
        <EventCard {...makeProps({ event, onToggle })} />
      </ul>,
    );

    // Click the main area (role=button)
    const button = screen.getByRole('button', { name: /Expand|Collapse/i });
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('applies selected state styling', () => {
    const { container } = render(
      <ul>
        <EventCard {...makeProps({ isSelected: true })} />
      </ul>,
    );

    const li = container.querySelector('li');
    expect(li?.className).toContain('bg-muted/60');
  });

  it('shows "Read full log" button for long messages when expanded', () => {
    // Create a message long enough to trigger the full-message button (>320 chars)
    const longMessage = 'A'.repeat(400);
    const event = makeEvent({ message: longMessage });
    render(
      <ul>
        <EventCard {...makeProps({ event, isExpanded: true })} />
      </ul>,
    );

    expect(screen.getByText('Read full log')).toBeTruthy();
  });

  it('calls onOpenFullMessage when "Read full log" is clicked', () => {
    const onOpenFullMessage = mock(() => {});
    const longMessage = 'B'.repeat(400);
    const event = makeEvent({ message: longMessage });
    render(
      <ul>
        <EventCard {...makeProps({ event, isExpanded: true, onOpenFullMessage })} />
      </ul>,
    );

    fireEvent.click(screen.getByText('Read full log'));
    expect(onOpenFullMessage).toHaveBeenCalledTimes(1);
  });

  it('renders diagnostics button and fires callback', () => {
    const onOpenDiagnostics = mock(() => {});
    render(
      <ul>
        <EventCard {...makeProps({ onOpenDiagnostics })} />
      </ul>,
    );

    const diagButton = screen.getByLabelText('View diagnostics');
    fireEvent.click(diagButton);
    expect(onOpenDiagnostics).toHaveBeenCalledWith('evt-1');
  });

  it('renders node ID when present', () => {
    const event = makeEvent({ nodeId: 'my-node' });
    render(
      <ul>
        <EventCard {...makeProps({ event })} />
      </ul>,
    );

    expect(screen.getByText('Node my-node')).toBeTruthy();
  });

  it('shows attempt badge when metadata.attempt exists', () => {
    const event = makeEvent({ metadata: { attempt: 3 } });
    render(
      <ul>
        <EventCard {...makeProps({ event })} />
      </ul>,
    );

    expect(screen.getByText('Attempt 3')).toBeTruthy();
  });
});
