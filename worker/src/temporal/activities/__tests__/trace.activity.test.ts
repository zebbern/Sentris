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
  it('fails closed when the required trace publisher is not initialized', async () => {
    await expect(recordTraceEventActivity(createTraceEvent())).rejects.toThrow(
      'Trace service not initialized',
    );
  });

  it('records trace event via the trace service when initialized', async () => {
    const previousDebugValue = process.env.SENTRIS_DEBUG_WORKFLOW;
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const trace = createMockTrace();

    try {
      delete process.env.SENTRIS_DEBUG_WORKFLOW;
      initializeTraceActivity({ trace: trace as any });

      const event = createTraceEvent({ type: 'NODE_COMPLETED', nodeRef: 'node-2' });
      await recordTraceEventActivity(event);

      expect(trace.record).toHaveBeenCalledTimes(1);
      expect(trace.record).toHaveBeenCalledWith(event);
      expect(consoleSpy).not.toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
      if (previousDebugValue === undefined) {
        delete process.env.SENTRIS_DEBUG_WORKFLOW;
      } else {
        process.env.SENTRIS_DEBUG_WORKFLOW = previousDebugValue;
      }
    }
  });

  it('waits for durable publication before the Temporal activity completes', async () => {
    let releaseRecord: (() => void) | undefined;
    const recordGate = new Promise<void>((resolve) => {
      releaseRecord = resolve;
    });
    const trace = {
      record: vi.fn(async () => recordGate),
    };
    initializeTraceActivity({ trace });
    let completed = false;

    const activity = recordTraceEventActivity(createTraceEvent()).then(() => {
      completed = true;
    });
    await Promise.resolve();

    expect(completed).toBe(false);
    releaseRecord?.();
    await activity;
    expect(completed).toBe(true);
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
