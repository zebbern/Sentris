import { describe, it, expect } from 'bun:test';
import {
  terminalKey,
  mapStatusToLifecycle,
  mergeById,
  mergeEvents,
  mergeLogEntries,
  deriveNodeStates,
  MAX_TERMINAL_CHUNKS,
  MAX_TRACKED_RUNS,
} from '../helpers';
import type { ExecutionLog } from '@/schemas/execution';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const makeLog = (overrides: Partial<ExecutionLog> = {}): ExecutionLog => ({
  id: `log-${Math.random().toString(36).slice(2, 8)}`,
  runId: 'run-1',
  nodeId: 'node-1',
  type: 'PROGRESS',
  level: 'info',
  timestamp: new Date().toISOString(),
  message: 'test log',
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('execution helpers — constants', () => {
  it('MAX_TERMINAL_CHUNKS is 500', () => {
    expect(MAX_TERMINAL_CHUNKS).toBe(500);
  });

  it('MAX_TRACKED_RUNS is 10', () => {
    expect(MAX_TRACKED_RUNS).toBe(10);
  });
});

describe('terminalKey', () => {
  it('concatenates nodeId and stream with colon', () => {
    expect(terminalKey('node-1', 'pty')).toBe('node-1:pty');
  });

  it('defaults stream to pty', () => {
    expect(terminalKey('node-1')).toBe('node-1:pty');
  });

  it('handles stdout and stderr streams', () => {
    expect(terminalKey('node-1', 'stdout')).toBe('node-1:stdout');
    expect(terminalKey('node-1', 'stderr')).toBe('node-1:stderr');
  });
});

describe('mapStatusToLifecycle', () => {
  it('maps QUEUED to queued', () => {
    expect(mapStatusToLifecycle('QUEUED')).toBe('queued');
  });

  it('maps RUNNING to running', () => {
    expect(mapStatusToLifecycle('RUNNING')).toBe('running');
  });

  it('maps COMPLETED to completed', () => {
    expect(mapStatusToLifecycle('COMPLETED')).toBe('completed');
  });

  it('maps FAILED to failed', () => {
    expect(mapStatusToLifecycle('FAILED')).toBe('failed');
  });

  it('maps CANCELLED to cancelled', () => {
    expect(mapStatusToLifecycle('CANCELLED')).toBe('cancelled');
  });

  it('maps TERMINATED to cancelled', () => {
    expect(mapStatusToLifecycle('TERMINATED')).toBe('cancelled');
  });

  it('maps TIMED_OUT to failed', () => {
    expect(mapStatusToLifecycle('TIMED_OUT')).toBe('failed');
  });

  it('maps undefined to idle', () => {
    expect(mapStatusToLifecycle(undefined)).toBe('idle');
  });

  it('maps unknown status to idle', () => {
    expect(mapStatusToLifecycle('UNKNOWN' as any)).toBe('idle');
  });
});

describe('mergeById', () => {
  it('returns existing array when incoming is empty', () => {
    const existing = [makeLog({ id: 'a' })];
    const result = mergeById(existing, []);
    expect(result).toBe(existing);
  });

  it('appends new entries to existing', () => {
    const existing = [makeLog({ id: 'a' })];
    const incoming = [makeLog({ id: 'b' })];
    const result = mergeById(existing, incoming);
    expect(result).toHaveLength(2);
    expect(result[1].id).toBe('b');
  });

  it('deduplicates entries by id', () => {
    const existing = [makeLog({ id: 'a' }), makeLog({ id: 'b' })];
    const incoming = [makeLog({ id: 'b' }), makeLog({ id: 'c' })];
    const result = mergeById(existing, incoming);
    expect(result).toHaveLength(3);
    expect(result.map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('returns existing array when all incoming are duplicates', () => {
    const existing = [makeLog({ id: 'a' })];
    const incoming = [makeLog({ id: 'a' })];
    const result = mergeById(existing, incoming);
    expect(result).toBe(existing);
  });
});

describe('mergeEvents and mergeLogEntries are aliases', () => {
  it('mergeEvents is the same function as mergeById', () => {
    expect(mergeEvents).toBe(mergeById);
  });

  it('mergeLogEntries is the same function as mergeById', () => {
    expect(mergeLogEntries).toBe(mergeById);
  });
});

describe('deriveNodeStates', () => {
  it('returns empty record for empty events', () => {
    expect(deriveNodeStates([])).toEqual({});
  });

  it('sets node to running on STARTED event', () => {
    const events = [makeLog({ nodeId: 'n1', type: 'STARTED' })];
    const states = deriveNodeStates(events);
    expect(states['n1']).toBe('running');
  });

  it('sets node to running on PROGRESS event when not seen before', () => {
    const events = [makeLog({ nodeId: 'n1', type: 'PROGRESS' })];
    const states = deriveNodeStates(events);
    expect(states['n1']).toBe('running');
  });

  it('does not override existing state on PROGRESS', () => {
    const events = [
      makeLog({ nodeId: 'n1', type: 'STARTED' }),
      makeLog({ nodeId: 'n1', type: 'PROGRESS' }),
    ];
    const states = deriveNodeStates(events);
    expect(states['n1']).toBe('running');
  });

  it('sets node to success on COMPLETED event', () => {
    const events = [
      makeLog({ nodeId: 'n1', type: 'STARTED' }),
      makeLog({ nodeId: 'n1', type: 'COMPLETED' }),
    ];
    const states = deriveNodeStates(events);
    expect(states['n1']).toBe('success');
  });

  it('sets node to error on FAILED event', () => {
    const events = [
      makeLog({ nodeId: 'n1', type: 'STARTED' }),
      makeLog({ nodeId: 'n1', type: 'FAILED' }),
    ];
    const states = deriveNodeStates(events);
    expect(states['n1']).toBe('error');
  });

  it('tracks multiple nodes independently', () => {
    const events = [
      makeLog({ nodeId: 'n1', type: 'STARTED' }),
      makeLog({ nodeId: 'n2', type: 'COMPLETED' }),
    ];
    const states = deriveNodeStates(events);
    expect(states['n1']).toBe('running');
    expect(states['n2']).toBe('success');
  });

  it('skips events without nodeId', () => {
    const events = [makeLog({ nodeId: '', type: 'STARTED' })];
    const states = deriveNodeStates(events);
    expect(Object.keys(states)).toHaveLength(0);
  });

  it('ignores unknown event types', () => {
    const events = [makeLog({ nodeId: 'n1', type: 'UNKNOWN' as any })];
    const states = deriveNodeStates(events);
    expect(states['n1']).toBeUndefined();
  });
});
