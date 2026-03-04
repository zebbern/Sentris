import { describe, it, expect, vi } from 'bun:test';
import { initializeTraceActivity, recordTraceEventActivity } from '../trace.activity';
import type { TraceEvent } from '@sentris/component-sdk';

// ── Test helpers ─────────────────────────────────────────────────────────────

function createMockTrace() {
  return {
    record: vi.fn(),
  };
}

function createTraceEvent(overrides: Partial<TraceEvent> = {}): TraceEvent {
  return {
    type: 'NODE_STARTED',
    runId: 'run-1',
    nodeRef: 'node-1',
    timestamp: new Date().toISOString(),
    level: 'info',
    ...overrides,
  } as TraceEvent;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('recordTraceEventActivity', () => {
  it('skips recording when trace is not initialized', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Call without initializing — should not throw, just warn
    const event = createTraceEvent();
    await recordTraceEventActivity(event);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Trace service not initialized'),
      expect.anything(),
    );

    consoleSpy.mockRestore();
  });

  it('records trace event via the trace service when initialized', async () => {
    const trace = createMockTrace();
    initializeTraceActivity({ trace: trace as any });

    const event = createTraceEvent({ type: 'NODE_COMPLETED', nodeRef: 'node-2' });
    await recordTraceEventActivity(event);

    expect(trace.record).toHaveBeenCalledTimes(1);
    expect(trace.record).toHaveBeenCalledWith(event);
  });

  it('records different event types correctly', async () => {
    const trace = createMockTrace();
    initializeTraceActivity({ trace: trace as any });

    const startEvent = createTraceEvent({ type: 'NODE_STARTED' });
    const failEvent = createTraceEvent({ type: 'NODE_FAILED', level: 'error' });

    await recordTraceEventActivity(startEvent);
    await recordTraceEventActivity(failEvent);

    expect(trace.record).toHaveBeenCalledTimes(2);
  });
});
