import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useExecutionTimelineStore } from '@/store/executionTimelineStore';
import { useWorkflowUiStore } from '@/store/workflowUiStore';
import { clampValue } from './execution-timeline/utils';
import { PlaybackControls } from './execution-timeline/PlaybackControls';
import { TimelineTrack } from './execution-timeline/TimelineTrack';
import { TimelineOverview } from './execution-timeline/TimelineOverview';
import { TimelineStatusBar } from './execution-timeline/TimelineStatusBar';

export function ExecutionTimeline() {
  const [timelineStart, setTimelineStart] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const timelineRef = useRef<HTMLDivElement>(null);

  const selectedRunId = useExecutionTimelineStore((state) => state.selectedRunId);
  const events = useExecutionTimelineStore((state) => state.events);
  const totalDuration = useExecutionTimelineStore((state) => state.totalDuration);
  const eventDuration = useExecutionTimelineStore((state) => state.eventDuration);
  const currentTime = useExecutionTimelineStore((state) => state.currentTime);
  const playbackMode = useExecutionTimelineStore((state) => state.playbackMode);
  const isPlaying = useExecutionTimelineStore((state) => state.isPlaying);
  const playbackSpeed = useExecutionTimelineStore((state) => state.playbackSpeed);
  const isSeeking = useExecutionTimelineStore((state) => state.isSeeking);
  const nodeStates = useExecutionTimelineStore((state) => state.nodeStates);
  const showTimeline = useExecutionTimelineStore((state) => state.showTimeline);
  const timelineZoom = useExecutionTimelineStore((state) => state.timelineZoom);
  const play = useExecutionTimelineStore((state) => state.play);
  const pause = useExecutionTimelineStore((state) => state.pause);
  const seek = useExecutionTimelineStore((state) => state.seek);
  const setPlaybackSpeed = useExecutionTimelineStore((state) => state.setPlaybackSpeed);
  const stepForward = useExecutionTimelineStore((state) => state.stepForward);
  const stepBackward = useExecutionTimelineStore((state) => state.stepBackward);
  const setTimelineZoom = useExecutionTimelineStore((state) => state.setTimelineZoom);
  const isLiveFollowing = useExecutionTimelineStore((state) => state.isLiveFollowing);
  const goLive = useExecutionTimelineStore((state) => state.goLive);
  const tickLiveClock = useExecutionTimelineStore((state) => state.tickLiveClock);
  const timelineStartTime = useExecutionTimelineStore((state) => state.timelineStartTime);
  const agentMarkersRunId = useExecutionTimelineStore((state) => state.agentMarkersRunId);
  const agentMarkers = useExecutionTimelineStore((state) => state.agentMarkers);

  const showHeatMap = useWorkflowUiStore((s) => s.showHeatMap);
  const toggleHeatMap = useWorkflowUiStore((s) => s.toggleHeatMap);

  const isLiveMode = playbackMode === 'live';
  const overviewDuration = Math.max(eventDuration, totalDuration);
  const safeDuration = Math.max(totalDuration, 1);
  const normalizedProgress = clampValue(currentTime / safeDuration, 0, 1);
  const viewportWidth = 1 / timelineZoom;
  const maxStart = Math.max(0, 1 - viewportWidth);
  const clampedStart = clampValue(timelineStart, 0, maxStart);
  const visibleProgress = clampValue(
    viewportWidth >= 1 ? normalizedProgress : (normalizedProgress - clampedStart) / viewportWidth,
    0,
    1,
  );
  const viewportStartMs = clampedStart * safeDuration;
  const viewportEndMs = Math.min(safeDuration, (clampedStart + viewportWidth) * safeDuration);

  useEffect(() => {
    if (!selectedRunId) return;
    setTimelineStart(0);
    setTimelineZoom(1);
  }, [selectedRunId, setTimelineZoom]);

  useEffect(() => {
    setTimelineStart((prev) => clampValue(prev, 0, maxStart));
  }, [maxStart]);

  useEffect(() => {
    if (!isLiveMode) return;
    let frame: number;
    const pump = () => {
      tickLiveClock();
      frame = requestAnimationFrame(pump);
    };
    frame = requestAnimationFrame(pump);
    return () => cancelAnimationFrame(frame);
  }, [isLiveMode, tickLiveClock]);

  useEffect(() => {
    const guard = viewportWidth >= 1 ? 0 : viewportWidth * 0.15;
    const lowerBound = clampedStart + guard;
    const upperBound = clampedStart + viewportWidth - guard;
    if (normalizedProgress < lowerBound) {
      setTimelineStart(clampValue(normalizedProgress - guard, 0, maxStart));
    } else if (normalizedProgress > upperBound) {
      setTimelineStart(clampValue(normalizedProgress - (viewportWidth - guard), 0, maxStart));
    }
  }, [normalizedProgress, viewportWidth, clampedStart, maxStart]);

  const getTimeFromClientX = useCallback(
    (clientX: number) => {
      const rect = timelineRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return null;
      const relative = clampValue((clientX - rect.left) / rect.width, 0, 1);
      const normalized = clampValue(clampedStart + relative * viewportWidth, 0, 1);
      return normalized * safeDuration;
    },
    [clampedStart, viewportWidth, safeDuration],
  );

  const seekFromClientX = useCallback(
    (clientX: number) => {
      const next = getTimeFromClientX(clientX);
      if (next == null) return;
      seek(next);
    },
    [getTimeFromClientX, seek],
  );

  const handleTrackMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      setIsDragging(true);
      seekFromClientX(event.clientX);
    },
    [seekFromClientX],
  );

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (event: MouseEvent) => {
      seekFromClientX(event.clientX);
    };
    const onUp = () => setIsDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isDragging, seekFromClientX]);

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (!timelineRef.current) return;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const rect = timelineRef.current.getBoundingClientRect();
        const pivotRatio = clampValue((event.clientX - rect.left) / rect.width, 0, 1);
        const pivotPoint = clampedStart + pivotRatio * viewportWidth;
        const delta = event.deltaY > 0 ? -0.5 : 0.5;
        const nextZoom = clampValue(timelineZoom + delta, 1, 100);
        if (nextZoom === timelineZoom) return;
        const nextViewportWidth = 1 / nextZoom;
        const nextMaxStart = Math.max(0, 1 - nextViewportWidth);
        const nextStart = clampValue(pivotPoint - nextViewportWidth * pivotRatio, 0, nextMaxStart);
        setTimelineZoom(nextZoom);
        setTimelineStart(nextStart);
      } else if (timelineZoom > 1) {
        event.preventDefault();
        const delta = (event.deltaY / 500) * viewportWidth;
        setTimelineStart((prev) => clampValue(prev + delta, 0, maxStart));
      }
    },
    [timelineZoom, viewportWidth, clampedStart, maxStart, setTimelineZoom],
  );

  const handlePlayPause = useCallback(() => {
    if (playbackMode === 'live') return;
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  }, [isPlaying, play, pause, playbackMode]);

  const handleSpeedChange = useCallback(
    (speed: number) => {
      setPlaybackSpeed(speed);
    },
    [setPlaybackSpeed],
  );

  const handlePlayheadMouseDown = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setIsDragging(true);
      seekFromClientX(event.clientX);
    },
    [seekFromClientX],
  );

  const markerData = useMemo(() => {
    if (events.length === 0) return [];
    return events.map((event) => {
      const normalized = clampValue(event.offsetMs / safeDuration, 0, 1);
      const viewportPosition =
        viewportWidth >= 1 ? normalized : (normalized - clampedStart) / viewportWidth;
      return {
        id: event.id,
        type: event.type,
        timestamp: event.timestamp,
        viewportPosition,
        normalizedPosition: normalized,
        visible: viewportPosition >= 0 && viewportPosition <= 1,
      };
    });
  }, [events, safeDuration, clampedStart, viewportWidth]);

  const visibleMarkers = markerData.filter((marker) => marker.visible);
  const baseTimelineStart =
    timelineStartTime ?? (events.length > 0 ? new Date(events[0].timestamp).getTime() : null);
  const agentMarkerData = useMemo(() => {
    if (!baseTimelineStart) return [];
    if (!selectedRunId || agentMarkersRunId !== selectedRunId) return [];
    const flatMarkers = Object.values(agentMarkers).flat();
    return flatMarkers.map((marker) => {
      const markerTime = new Date(marker.timestamp).getTime();
      const offsetMs = markerTime - baseTimelineStart;
      const normalized = clampValue(offsetMs / safeDuration, 0, 1);
      const viewportPosition =
        viewportWidth >= 1 ? normalized : (normalized - clampedStart) / viewportWidth;
      return {
        id: marker.id,
        label: marker.label,
        timestamp: marker.timestamp,
        viewportPosition,
        normalizedPosition: normalized,
        visible: viewportPosition >= 0 && viewportPosition <= 1,
      };
    });
  }, [
    agentMarkers,
    agentMarkersRunId,
    baseTimelineStart,
    clampedStart,
    safeDuration,
    selectedRunId,
    viewportWidth,
  ]);
  const visibleAgentMarkers = agentMarkerData.filter((marker) => marker.visible);

  const handlePreviewPointer = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      if (!rect.width) return;
      const ratio = clampValue((event.clientX - rect.left) / rect.width, 0, 1);
      const nextStart = clampValue(ratio - viewportWidth / 2, 0, maxStart);
      setTimelineStart(nextStart);
    },
    [viewportWidth, maxStart],
  );

  useEffect(() => {
    if (!isPlaying || playbackMode !== 'replay') return;
    let frame: number;
    const step = () => {
      const state = useExecutionTimelineStore.getState();
      const delta = 16.67 * state.playbackSpeed;
      const nextTime = Math.min(state.totalDuration, state.currentTime + delta);
      if (nextTime >= state.totalDuration) {
        pause();
        seek(state.totalDuration);
        return;
      }
      seek(nextTime);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [isPlaying, playbackMode, pause, seek]);

  if (!selectedRunId || !showTimeline) {
    return null;
  }

  return (
    <div className="border-t bg-background">
      <div className="p-4 space-y-4">
        <PlaybackControls
          currentTime={currentTime}
          totalDuration={totalDuration}
          isPlaying={isPlaying}
          playbackMode={playbackMode}
          playbackSpeed={playbackSpeed}
          isLiveFollowing={isLiveFollowing}
          showHeatMap={showHeatMap}
          onPlayPause={handlePlayPause}
          onStepForward={stepForward}
          onStepBackward={stepBackward}
          onSpeedChange={handleSpeedChange}
          onGoLive={goLive}
          onToggleHeatMap={toggleHeatMap}
        />

        <TimelineTrack
          ref={timelineRef}
          visibleProgress={visibleProgress}
          visibleMarkers={visibleMarkers}
          visibleAgentMarkers={visibleAgentMarkers}
          isLiveMode={isLiveMode}
          playbackMode={playbackMode}
          currentTime={currentTime}
          viewportStartMs={viewportStartMs}
          viewportEndMs={viewportEndMs}
          onMouseDown={handleTrackMouseDown}
          onWheel={handleWheel}
          onPlayheadMouseDown={handlePlayheadMouseDown}
        />

        <TimelineOverview
          markerData={markerData}
          clampedStart={clampedStart}
          viewportWidth={viewportWidth}
          normalizedProgress={normalizedProgress}
          isLiveMode={isLiveMode}
          timelineZoom={timelineZoom}
          overviewDuration={overviewDuration}
          onPreviewPointer={handlePreviewPointer}
        />

        <TimelineStatusBar
          eventCount={events.length}
          nodeCount={Object.keys(nodeStates).length}
          playbackSpeed={playbackSpeed}
          playbackMode={playbackMode}
          isSeeking={isSeeking}
          isPlaying={isPlaying}
        />
      </div>
    </div>
  );
}
