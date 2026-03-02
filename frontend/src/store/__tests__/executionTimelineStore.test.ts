import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { realModuleExports } from '@/test/restore-mocks';

// Override any bled mock.module with the real store
mock.module('@/store/executionTimelineStore', () =>
  realModuleExports('@/store/executionTimelineStore'),
);

import { useExecutionTimelineStore, INITIAL_STATE, PLAYBACK_SPEEDS } from '../executionTimeline';

describe('executionTimelineStore (barrel re-export)', () => {
  beforeEach(() => {
    useExecutionTimelineStore.getState().reset();
  });

  it('re-exports the combined store with initial state', () => {
    const state = useExecutionTimelineStore.getState();
    expect(state.events).toEqual([]);
    expect(state.dataFlows).toEqual([]);
    expect(state.selectedRunId).toBeNull();
    expect(state.currentTime).toBe(0);
    expect(state.playbackMode).toBe('replay');
    expect(state.isPlaying).toBe(false);
    expect(state.showTimeline).toBe(true);
    expect(state.selectedNodeId).toBeNull();
    expect(state.selectedEventId).toBeNull();
  });

  it('exposes INITIAL_STATE constant', () => {
    expect(INITIAL_STATE).toBeDefined();
    expect(INITIAL_STATE.playbackMode).toBe('replay');
    expect(INITIAL_STATE.events).toEqual([]);
    expect(INITIAL_STATE.isPlaying).toBe(false);
  });

  it('exposes PLAYBACK_SPEEDS constant', () => {
    expect(PLAYBACK_SPEEDS).toEqual([0.1, 0.5, 1, 2, 5, 10]);
  });
});

describe('timelineEventStore (via combined store)', () => {
  beforeEach(() => {
    useExecutionTimelineStore.getState().reset();
  });

  it('selectEvent sets selectedEventId', () => {
    useExecutionTimelineStore.getState().selectEvent('evt-1');
    expect(useExecutionTimelineStore.getState().selectedEventId).toBe('evt-1');
  });

  it('selectEvent with null clears selection', () => {
    useExecutionTimelineStore.getState().selectEvent('evt-1');
    useExecutionTimelineStore.getState().selectEvent(null);
    expect(useExecutionTimelineStore.getState().selectedEventId).toBeNull();
  });

  it('selectNode sets selectedNodeId and clears selectedEventId', () => {
    useExecutionTimelineStore.getState().selectEvent('evt-1');
    useExecutionTimelineStore.getState().selectNode('node-1');
    const state = useExecutionTimelineStore.getState();
    expect(state.selectedNodeId).toBe('node-1');
    expect(state.selectedEventId).toBeNull();
  });

  it('selectNode with null clears selectedNodeId', () => {
    useExecutionTimelineStore.getState().selectNode('node-1');
    useExecutionTimelineStore.getState().selectNode(null);
    expect(useExecutionTimelineStore.getState().selectedNodeId).toBeNull();
  });

  it('selectNode saves selection history when selectedRunId is set', () => {
    useExecutionTimelineStore.setState({ selectedRunId: 'run-1' });
    useExecutionTimelineStore.getState().selectNode('node-A');
    const state = useExecutionTimelineStore.getState();
    expect(state.nodeSelectionHistory['run-1']).toBe('node-A');
  });

  it('setAgentMarkers stores markers for a run and node', () => {
    const markers = [
      { id: 'm1', nodeId: 'node-1', label: 'Start', timestamp: '2026-01-01T00:00:00Z' },
      { id: 'm2', nodeId: 'node-1', label: 'End', timestamp: '2026-01-01T00:01:00Z' },
    ];
    useExecutionTimelineStore.getState().setAgentMarkers('run-1', 'node-1', markers);
    const state = useExecutionTimelineStore.getState();
    expect(state.agentMarkersRunId).toBe('run-1');
    expect(state.agentMarkers['node-1']).toEqual(markers);
  });

  it('setAgentMarkers with empty array removes markers for that node', () => {
    const markers = [
      { id: 'm1', nodeId: 'node-1', label: 'Start', timestamp: '2026-01-01T00:00:00Z' },
    ];
    useExecutionTimelineStore.getState().setAgentMarkers('run-1', 'node-1', markers);
    useExecutionTimelineStore.getState().setAgentMarkers('run-1', 'node-1', []);
    const state = useExecutionTimelineStore.getState();
    expect(state.agentMarkers['node-1']).toBeUndefined();
  });

  it('setAgentMarkers clears markers from other runs', () => {
    const markers1 = [{ id: 'm1', nodeId: 'n1', label: 'A', timestamp: '2026-01-01T00:00:00Z' }];
    const markers2 = [{ id: 'm2', nodeId: 'n2', label: 'B', timestamp: '2026-01-01T00:01:00Z' }];
    useExecutionTimelineStore.getState().setAgentMarkers('run-1', 'n1', markers1);
    useExecutionTimelineStore.getState().setAgentMarkers('run-2', 'n2', markers2);
    const state = useExecutionTimelineStore.getState();
    expect(state.agentMarkersRunId).toBe('run-2');
    // Markers from run-1 are cleared since it's a different run
    expect(state.agentMarkers['n1']).toBeUndefined();
    expect(state.agentMarkers['n2']).toEqual(markers2);
  });

  it('appendDataFlows with empty array is a no-op', () => {
    const before = useExecutionTimelineStore.getState().dataFlows;
    useExecutionTimelineStore.getState().appendDataFlows([]);
    expect(useExecutionTimelineStore.getState().dataFlows).toEqual(before);
  });
});

describe('timelineNavigationStore (via combined store)', () => {
  beforeEach(() => {
    useExecutionTimelineStore.getState().reset();
  });

  it('play sets isPlaying to true', () => {
    useExecutionTimelineStore.getState().play();
    expect(useExecutionTimelineStore.getState().isPlaying).toBe(true);
  });

  it('play does nothing in live mode', () => {
    useExecutionTimelineStore.setState({ playbackMode: 'live' });
    useExecutionTimelineStore.getState().play();
    expect(useExecutionTimelineStore.getState().isPlaying).toBe(false);
  });

  it('pause sets isPlaying to false', () => {
    useExecutionTimelineStore.setState({ isPlaying: true });
    useExecutionTimelineStore.getState().pause();
    expect(useExecutionTimelineStore.getState().isPlaying).toBe(false);
  });

  it('setPlaybackSpeed accepts valid speeds', () => {
    useExecutionTimelineStore.getState().setPlaybackSpeed(2);
    expect(useExecutionTimelineStore.getState().playbackSpeed).toBe(2);

    useExecutionTimelineStore.getState().setPlaybackSpeed(0.5);
    expect(useExecutionTimelineStore.getState().playbackSpeed).toBe(0.5);
  });

  it('setPlaybackSpeed rejects invalid speeds', () => {
    useExecutionTimelineStore.getState().setPlaybackSpeed(1);
    useExecutionTimelineStore.getState().setPlaybackSpeed(3);
    expect(useExecutionTimelineStore.getState().playbackSpeed).toBe(1);
  });

  it('toggleTimeline flips showTimeline', () => {
    expect(useExecutionTimelineStore.getState().showTimeline).toBe(true);
    useExecutionTimelineStore.getState().toggleTimeline();
    expect(useExecutionTimelineStore.getState().showTimeline).toBe(false);
    useExecutionTimelineStore.getState().toggleTimeline();
    expect(useExecutionTimelineStore.getState().showTimeline).toBe(true);
  });

  it('toggleEventInspector flips showEventInspector', () => {
    expect(useExecutionTimelineStore.getState().showEventInspector).toBe(false);
    useExecutionTimelineStore.getState().toggleEventInspector();
    expect(useExecutionTimelineStore.getState().showEventInspector).toBe(true);
  });

  it('setTimelineZoom clamps between 1.0 and 100.0', () => {
    useExecutionTimelineStore.getState().setTimelineZoom(50);
    expect(useExecutionTimelineStore.getState().timelineZoom).toBe(50);

    useExecutionTimelineStore.getState().setTimelineZoom(0);
    expect(useExecutionTimelineStore.getState().timelineZoom).toBe(1);

    useExecutionTimelineStore.getState().setTimelineZoom(200);
    expect(useExecutionTimelineStore.getState().timelineZoom).toBe(100);
  });

  it('seek clamps to totalDuration', () => {
    useExecutionTimelineStore.setState({ totalDuration: 5000 });
    useExecutionTimelineStore.getState().seek(3000);
    expect(useExecutionTimelineStore.getState().currentTime).toBe(3000);

    useExecutionTimelineStore.getState().seek(10000);
    expect(useExecutionTimelineStore.getState().currentTime).toBe(5000);

    useExecutionTimelineStore.getState().seek(-100);
    expect(useExecutionTimelineStore.getState().currentTime).toBe(0);
  });

  it('stepForward moves to next event offsetMs', () => {
    const events = [
      {
        offsetMs: 0,
        id: 'e1',
        timestamp: '2026-01-01T00:00:00Z',
        nodeId: 'n1',
        runId: 'r1',
        type: 'STARTED',
        level: 'info',
        visualTime: 0,
      },
      {
        offsetMs: 1000,
        id: 'e2',
        timestamp: '2026-01-01T00:00:01Z',
        nodeId: 'n1',
        runId: 'r1',
        type: 'PROGRESS',
        level: 'info',
        visualTime: 0.5,
      },
      {
        offsetMs: 2000,
        id: 'e3',
        timestamp: '2026-01-01T00:00:02Z',
        nodeId: 'n1',
        runId: 'r1',
        type: 'COMPLETED',
        level: 'info',
        visualTime: 1,
      },
    ] as any;
    useExecutionTimelineStore.setState({ events, totalDuration: 2000, currentTime: 0 });
    useExecutionTimelineStore.getState().stepForward();
    expect(useExecutionTimelineStore.getState().currentTime).toBe(1000);
  });

  it('stepBackward moves to previous event offsetMs', () => {
    const events = [
      {
        offsetMs: 0,
        id: 'e1',
        timestamp: '2026-01-01T00:00:00Z',
        nodeId: 'n1',
        runId: 'r1',
        type: 'STARTED',
        level: 'info',
        visualTime: 0,
      },
      {
        offsetMs: 1000,
        id: 'e2',
        timestamp: '2026-01-01T00:00:01Z',
        nodeId: 'n1',
        runId: 'r1',
        type: 'PROGRESS',
        level: 'info',
        visualTime: 0.5,
      },
    ] as any;
    useExecutionTimelineStore.setState({ events, totalDuration: 1000, currentTime: 1000 });
    useExecutionTimelineStore.getState().stepBackward();
    expect(useExecutionTimelineStore.getState().currentTime).toBe(0);
  });

  it('stepForward with no events is a no-op', () => {
    useExecutionTimelineStore.setState({ events: [], currentTime: 0 });
    useExecutionTimelineStore.getState().stepForward();
    expect(useExecutionTimelineStore.getState().currentTime).toBe(0);
  });
});

describe('timelinePollingStore (via combined store)', () => {
  beforeEach(() => {
    useExecutionTimelineStore.getState().reset();
  });

  it('reset restores initial state', () => {
    useExecutionTimelineStore.setState({
      selectedRunId: 'run-1',
      events: [{ id: 'e1' }] as any,
      currentTime: 5000,
      isPlaying: true,
    });
    useExecutionTimelineStore.getState().reset();
    const state = useExecutionTimelineStore.getState();
    expect(state.selectedRunId).toBeNull();
    expect(state.events).toEqual([]);
    expect(state.currentTime).toBe(0);
    expect(state.isPlaying).toBe(false);
  });

  it('goLive sets playbackMode to live and isLiveFollowing', () => {
    useExecutionTimelineStore.setState({
      selectedRunId: 'run-1',
      totalDuration: 3000,
      eventDuration: 2500,
    });
    useExecutionTimelineStore.getState().goLive();
    const state = useExecutionTimelineStore.getState();
    expect(state.playbackMode).toBe('live');
    expect(state.isLiveFollowing).toBe(true);
    expect(state.currentTime).toBe(3000);
  });

  it('goLive does nothing without selectedRunId', () => {
    useExecutionTimelineStore.getState().goLive();
    expect(useExecutionTimelineStore.getState().playbackMode).toBe('replay');
  });

  it('tickLiveClock does nothing in replay mode', () => {
    useExecutionTimelineStore.setState({ playbackMode: 'replay' });
    const timeBefore = useExecutionTimelineStore.getState().currentTime;
    useExecutionTimelineStore.getState().tickLiveClock();
    expect(useExecutionTimelineStore.getState().currentTime).toBe(timeBefore);
  });

  it('tickLiveClock does nothing without timelineStartTime', () => {
    useExecutionTimelineStore.setState({ playbackMode: 'live', timelineStartTime: null });
    useExecutionTimelineStore.getState().tickLiveClock();
    expect(useExecutionTimelineStore.getState().currentTime).toBe(0);
  });
});
