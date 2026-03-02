import { describe, it, expect, afterEach, mock } from 'bun:test';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { EventInspectorHeader } from '../EventInspectorHeader';
import type { EventInspectorHeaderProps } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProps(overrides: Partial<EventInspectorHeaderProps> = {}): EventInspectorHeaderProps {
  return {
    selectedRunId: 'run-1',
    selectedNodeId: null,
    filteredEventsCount: 0,
    displayEventsCount: 24,
    playbackMode: 'replay',
    isPlaying: false,
    isAutoScrolling: false,
    onClearNodeFilter: mock(() => {}),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EventInspectorHeader', () => {
  afterEach(cleanup);

  it('renders the "Event Inspector" heading', () => {
    render(<EventInspectorHeader {...makeProps()} />);

    expect(screen.getByText('Event Inspector')).toBeTruthy();
  });

  it('shows total event count when run is selected but no node filter', () => {
    render(
      <EventInspectorHeader {...makeProps({ selectedRunId: 'run-1', displayEventsCount: 42 })} />,
    );

    expect(screen.getByText('42 events across all nodes')).toBeTruthy();
  });

  it('shows prompt to select a run when no run is selected', () => {
    render(<EventInspectorHeader {...makeProps({ selectedRunId: null })} />);

    expect(screen.getByText('Select a run to explore execution events.')).toBeTruthy();
  });

  it('shows filtered count when node is selected and has events', () => {
    render(
      <EventInspectorHeader
        {...makeProps({
          selectedRunId: 'run-1',
          selectedNodeId: 'http-node',
          filteredEventsCount: 5,
        })}
      />,
    );

    expect(screen.getByText('5 events for http-node')).toBeTruthy();
  });

  it('shows fallback when node is selected but has no events', () => {
    render(
      <EventInspectorHeader
        {...makeProps({
          selectedRunId: 'run-1',
          selectedNodeId: 'empty-node',
          filteredEventsCount: 0,
        })}
      />,
    );

    expect(screen.getByText('No events for empty-node — showing all')).toBeTruthy();
  });

  it('shows LIVE badge in live mode', () => {
    render(<EventInspectorHeader {...makeProps({ playbackMode: 'live' })} />);

    expect(screen.getByText('LIVE')).toBeTruthy();
  });

  it('shows auto-scrolling in live mode when scrolling', () => {
    render(
      <EventInspectorHeader {...makeProps({ playbackMode: 'live', isAutoScrolling: true })} />,
    );

    expect(screen.getByText('• Auto-scrolling')).toBeTruthy();
  });

  it('shows FOLLOWING badge when replay is playing and auto-scrolling', () => {
    render(
      <EventInspectorHeader
        {...makeProps({
          playbackMode: 'replay',
          isPlaying: true,
          isAutoScrolling: true,
        })}
      />,
    );

    expect(screen.getByText('FOLLOWING')).toBeTruthy();
  });

  it('does not show FOLLOWING when not playing', () => {
    render(
      <EventInspectorHeader
        {...makeProps({
          playbackMode: 'replay',
          isPlaying: false,
          isAutoScrolling: true,
        })}
      />,
    );

    expect(screen.queryByText('FOLLOWING')).toBeNull();
  });

  it('shows node filter chip and clears on click', () => {
    const onClearNodeFilter = mock(() => {});
    render(
      <EventInspectorHeader {...makeProps({ selectedNodeId: 'my-node', onClearNodeFilter })} />,
    );

    expect(screen.getByText('Node filter')).toBeTruthy();
    expect(screen.getByText('my-node')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Clear node filter'));
    expect(onClearNodeFilter).toHaveBeenCalledTimes(1);
  });

  it('does not show node filter chip when no node is selected', () => {
    render(<EventInspectorHeader {...makeProps({ selectedNodeId: null })} />);

    expect(screen.queryByText('Node filter')).toBeNull();
  });
});
