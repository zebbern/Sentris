import { describe, it, expect, beforeEach } from 'bun:test';
import { useExecutionLogStore } from '../executionLogStore';
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
  message: 'test message',
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('executionLogStore', () => {
  beforeEach(() => {
    useExecutionLogStore.getState().resetLogs();
  });

  // --- Initial state ---

  it('initializes with empty log arrays and live mode', () => {
    const state = useExecutionLogStore.getState();
    expect(state.liveLogs).toEqual([]);
    expect(state.historicalLogs).toEqual([]);
    expect(state.scrubberLogs).toEqual([]);
    expect(state.logMode).toBe('live');
    expect(state.logCursor).toBeNull();
  });

  // --- mergeLiveLogs ---

  it('mergeLiveLogs appends new log entries', () => {
    const log1 = makeLog({ id: 'log-1' });
    const log2 = makeLog({ id: 'log-2' });
    useExecutionLogStore.getState().mergeLiveLogs([log1, log2]);
    expect(useExecutionLogStore.getState().liveLogs).toHaveLength(2);
  });

  it('mergeLiveLogs deduplicates by id', () => {
    const log1 = makeLog({ id: 'log-1' });
    useExecutionLogStore.getState().mergeLiveLogs([log1]);
    useExecutionLogStore.getState().mergeLiveLogs([log1, makeLog({ id: 'log-2' })]);
    expect(useExecutionLogStore.getState().liveLogs).toHaveLength(2);
  });

  it('mergeLiveLogs updates cursor when provided', () => {
    const log1 = makeLog({ id: 'log-1' });
    useExecutionLogStore.getState().mergeLiveLogs([log1], 'cursor-abc');
    expect(useExecutionLogStore.getState().logCursor).toBe('cursor-abc');
  });

  it('mergeLiveLogs preserves existing cursor when new cursor is undefined', () => {
    useExecutionLogStore.getState().mergeLiveLogs([makeLog({ id: 'log-1' })], 'cursor-1');
    useExecutionLogStore.getState().mergeLiveLogs([makeLog({ id: 'log-2' })]);
    expect(useExecutionLogStore.getState().logCursor).toBe('cursor-1');
  });

  it('mergeLiveLogs is a no-op for empty array', () => {
    useExecutionLogStore.getState().mergeLiveLogs([makeLog({ id: 'a' })]);
    const before = useExecutionLogStore.getState().liveLogs;
    useExecutionLogStore.getState().mergeLiveLogs([]);
    expect(useExecutionLogStore.getState().liveLogs).toBe(before);
  });

  // --- setLogMode ---

  it('setLogMode changes the active mode', () => {
    useExecutionLogStore.getState().setLogMode('historical');
    expect(useExecutionLogStore.getState().logMode).toBe('historical');

    useExecutionLogStore.getState().setLogMode('scrubbing');
    expect(useExecutionLogStore.getState().logMode).toBe('scrubbing');

    useExecutionLogStore.getState().setLogMode('live');
    expect(useExecutionLogStore.getState().logMode).toBe('live');
  });

  // --- getDisplayLogs ---

  it('getDisplayLogs returns liveLogs in live mode', () => {
    const log = makeLog({ id: 'live-1' });
    useExecutionLogStore.getState().mergeLiveLogs([log]);
    useExecutionLogStore.getState().setLogMode('live');
    const display = useExecutionLogStore.getState().getDisplayLogs();
    expect(display).toHaveLength(1);
    expect(display[0].id).toBe('live-1');
  });

  it('getDisplayLogs returns historicalLogs in historical mode', () => {
    useExecutionLogStore.setState({
      historicalLogs: [makeLog({ id: 'hist-1' })],
    });
    useExecutionLogStore.getState().setLogMode('historical');
    const display = useExecutionLogStore.getState().getDisplayLogs();
    expect(display).toHaveLength(1);
    expect(display[0].id).toBe('hist-1');
  });

  it('getDisplayLogs returns scrubberLogs in scrubbing mode', () => {
    useExecutionLogStore.setState({
      scrubberLogs: [makeLog({ id: 'scrub-1' })],
    });
    useExecutionLogStore.getState().setLogMode('scrubbing');
    const display = useExecutionLogStore.getState().getDisplayLogs();
    expect(display).toHaveLength(1);
    expect(display[0].id).toBe('scrub-1');
  });

  // --- getNodeLogs ---

  it('getNodeLogs filters by nodeId', () => {
    useExecutionLogStore
      .getState()
      .mergeLiveLogs([
        makeLog({ id: 'a', nodeId: 'node-1' }),
        makeLog({ id: 'b', nodeId: 'node-2' }),
        makeLog({ id: 'c', nodeId: 'node-1' }),
      ]);
    const result = useExecutionLogStore.getState().getNodeLogs('node-1');
    expect(result).toHaveLength(2);
    expect(result.every((log) => log.nodeId === 'node-1')).toBe(true);
  });

  it('getNodeLogs returns empty array for unknown node', () => {
    useExecutionLogStore.getState().mergeLiveLogs([makeLog({ id: 'a', nodeId: 'node-1' })]);
    expect(useExecutionLogStore.getState().getNodeLogs('unknown')).toEqual([]);
  });

  // --- getNodeLogCounts ---

  it('getNodeLogCounts returns total, errors, and warnings', () => {
    useExecutionLogStore
      .getState()
      .mergeLiveLogs([
        makeLog({ id: 'a', nodeId: 'n1', level: 'info' }),
        makeLog({ id: 'b', nodeId: 'n1', level: 'error' }),
        makeLog({ id: 'c', nodeId: 'n1', level: 'warn' }),
        makeLog({ id: 'd', nodeId: 'n1', level: 'error' }),
      ]);
    const counts = useExecutionLogStore.getState().getNodeLogCounts('n1');
    expect(counts.total).toBe(4);
    expect(counts.errors).toBe(2);
    expect(counts.warnings).toBe(1);
  });

  it('getNodeLogCounts returns zeros for unknown node', () => {
    const counts = useExecutionLogStore.getState().getNodeLogCounts('unknown');
    expect(counts).toEqual({ total: 0, errors: 0, warnings: 0 });
  });

  // --- getLastLogMessage ---

  it('getLastLogMessage returns last log message for a node', () => {
    useExecutionLogStore
      .getState()
      .mergeLiveLogs([
        makeLog({ id: 'a', nodeId: 'n1', message: 'first' }),
        makeLog({ id: 'b', nodeId: 'n1', message: 'second' }),
      ]);
    expect(useExecutionLogStore.getState().getLastLogMessage('n1')).toBe('second');
  });

  it('getLastLogMessage returns null for unknown node', () => {
    expect(useExecutionLogStore.getState().getLastLogMessage('unknown')).toBeNull();
  });

  it('getLastLogMessage falls back to error.message if message is empty', () => {
    useExecutionLogStore
      .getState()
      .mergeLiveLogs([
        makeLog({ id: 'a', nodeId: 'n1', message: '', error: { message: 'err msg' } as any }),
      ]);
    expect(useExecutionLogStore.getState().getLastLogMessage('n1')).toBe('err msg');
  });

  // --- resetLogs ---

  it('resetLogs clears all state', () => {
    useExecutionLogStore.getState().mergeLiveLogs([makeLog({ id: 'a' })]);
    useExecutionLogStore.getState().setLogMode('historical');
    useExecutionLogStore.getState().resetLogs();
    const state = useExecutionLogStore.getState();
    expect(state.liveLogs).toEqual([]);
    expect(state.historicalLogs).toEqual([]);
    expect(state.scrubberLogs).toEqual([]);
    expect(state.logMode).toBe('live');
    expect(state.logCursor).toBeNull();
  });
});
