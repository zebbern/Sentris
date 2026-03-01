import type { StateCreator } from 'zustand';
import type { TimelineStore } from './types';
import { PLAYBACK_SPEEDS, calculateNodeStates } from './helpers';

// ---------------------------------------------------------------------------
// Navigation slice — playback controls and UI toggles
// ---------------------------------------------------------------------------

export interface NavigationSlice {
  // State
  isPlaying: boolean;
  playbackSpeed: number;
  isSeeking: boolean;
  currentTime: number;
  showTimeline: boolean;
  showEventInspector: boolean;
  timelineZoom: number;

  // Actions
  play: () => void;
  pause: () => void;
  seek: (timeMs: number) => void;
  setPlaybackSpeed: (speed: number) => void;
  stepForward: () => void;
  stepBackward: () => void;
  toggleTimeline: () => void;
  toggleEventInspector: () => void;
  setTimelineZoom: (zoom: number) => void;
}

export const createNavigationSlice: StateCreator<TimelineStore, [], [], NavigationSlice> = (
  set,
  get,
) => ({
  // State
  isPlaying: false,
  playbackSpeed: 1,
  isSeeking: false,
  currentTime: 0,
  showTimeline: true,
  showEventInspector: false,
  timelineZoom: 1,

  // Actions
  play: () => {
    if (get().playbackMode === 'live') return;
    set({ isPlaying: true });
  },

  pause: () => {
    set({ isPlaying: false });
  },

  seek: (timeMs: number) => {
    const state = get();
    const clampedTime = Math.max(0, Math.min(timeMs, state.totalDuration));
    set((prev) => ({
      currentTime: clampedTime,
      isSeeking: true,
      isLiveFollowing: prev.playbackMode === 'live' ? false : prev.isLiveFollowing,
    }));

    // Recalculate node states for new time
    const { events, dataFlows, timelineStartTime } = get();
    const newStates = calculateNodeStates(events, dataFlows, clampedTime, timelineStartTime);
    set({ nodeStates: newStates });

    // Clear seeking flag after a short delay
    setTimeout(() => set({ isSeeking: false }), 100);
  },

  setPlaybackSpeed: (speed: number) => {
    if (PLAYBACK_SPEEDS.includes(speed)) {
      set({ playbackSpeed: speed });
    }
  },

  stepForward: () => {
    const { currentTime, events, totalDuration } = get();
    if (events.length === 0) return;

    const nextEvent = events.find((event) => event.offsetMs > currentTime);

    if (nextEvent) {
      get().seek(nextEvent.offsetMs);
    } else {
      get().seek(totalDuration);
    }
  },

  stepBackward: () => {
    const { currentTime, events } = get();
    if (events.length === 0) return;
    const previousEvent = [...events].reverse().find((event) => event.offsetMs < currentTime);

    if (previousEvent) {
      get().seek(previousEvent.offsetMs);
    } else {
      get().seek(0);
    }
  },

  toggleTimeline: () => {
    set((state) => ({ showTimeline: !state.showTimeline }));
  },

  toggleEventInspector: () => {
    set((state) => ({ showEventInspector: !state.showEventInspector }));
  },

  setTimelineZoom: (zoom: number) => {
    set({ timelineZoom: Math.max(1.0, Math.min(100.0, zoom)) });
  },
});
