import { describe, it, expect, beforeEach } from 'bun:test';
import { useTerminalStreamStore } from '../terminalStreamStore';
import type { TerminalStreamChunk } from '../types';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const makeChunk = (overrides: Partial<TerminalStreamChunk> = {}): TerminalStreamChunk => ({
  nodeRef: 'node-1',
  stream: 'pty',
  chunkIndex: 1,
  payload: 'hello world',
  recordedAt: new Date().toISOString(),
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('terminalStreamStore', () => {
  beforeEach(() => {
    useTerminalStreamStore.getState().resetTerminalStreams();
  });

  // --- Initial state ---

  it('initializes with empty streams and null cursor', () => {
    const state = useTerminalStreamStore.getState();
    expect(state.terminalStreams).toEqual({});
    expect(state.terminalCursor).toBeNull();
  });

  // --- mergeStreamChunks ---

  it('mergeStreamChunks adds new chunks to stream', () => {
    const chunk = makeChunk({ chunkIndex: 1 });
    useTerminalStreamStore.getState().mergeStreamChunks([chunk]);

    const session = useTerminalStreamStore.getState().getTerminalSession('node-1', 'pty');
    expect(session).toBeDefined();
    expect(session!.chunks).toHaveLength(1);
    expect(session!.lastChunkIndex).toBe(1);
  });

  it('mergeStreamChunks ignores duplicate chunkIndex', () => {
    const chunk1 = makeChunk({ chunkIndex: 1, payload: 'first' });
    const chunk2 = makeChunk({ chunkIndex: 1, payload: 'duplicate' });

    useTerminalStreamStore.getState().mergeStreamChunks([chunk1]);
    useTerminalStreamStore.getState().mergeStreamChunks([chunk2]);

    const session = useTerminalStreamStore.getState().getTerminalSession('node-1', 'pty');
    expect(session!.chunks).toHaveLength(1);
    expect(session!.chunks[0].payload).toBe('first');
  });

  it('mergeStreamChunks appends higher chunkIndex', () => {
    useTerminalStreamStore.getState().mergeStreamChunks([makeChunk({ chunkIndex: 1 })]);
    useTerminalStreamStore
      .getState()
      .mergeStreamChunks([makeChunk({ chunkIndex: 2, payload: 'second' })]);

    const session = useTerminalStreamStore.getState().getTerminalSession('node-1', 'pty');
    expect(session!.chunks).toHaveLength(2);
    expect(session!.lastChunkIndex).toBe(2);
  });

  it('mergeStreamChunks updates cursor when provided', () => {
    useTerminalStreamStore.getState().mergeStreamChunks([makeChunk()], 'cursor-xyz');
    expect(useTerminalStreamStore.getState().terminalCursor).toBe('cursor-xyz');
  });

  it('mergeStreamChunks preserves cursor when not provided', () => {
    useTerminalStreamStore.getState().mergeStreamChunks([makeChunk({ chunkIndex: 1 })], 'cursor-1');
    useTerminalStreamStore.getState().mergeStreamChunks([makeChunk({ chunkIndex: 2 })]);
    expect(useTerminalStreamStore.getState().terminalCursor).toBe('cursor-1');
  });

  it('mergeStreamChunks is a no-op for empty array', () => {
    useTerminalStreamStore.getState().mergeStreamChunks([makeChunk({ chunkIndex: 1 })]);
    const before = useTerminalStreamStore.getState().terminalStreams;
    useTerminalStreamStore.getState().mergeStreamChunks([]);
    expect(useTerminalStreamStore.getState().terminalStreams).toBe(before);
  });

  it('mergeStreamChunks handles multiple streams per node', () => {
    useTerminalStreamStore
      .getState()
      .mergeStreamChunks([
        makeChunk({ nodeRef: 'node-1', stream: 'stdout', chunkIndex: 1, payload: 'stdout' }),
        makeChunk({ nodeRef: 'node-1', stream: 'stderr', chunkIndex: 1, payload: 'stderr' }),
      ]);

    const stdout = useTerminalStreamStore.getState().getTerminalSession('node-1', 'stdout');
    const stderr = useTerminalStreamStore.getState().getTerminalSession('node-1', 'stderr');
    expect(stdout!.chunks).toHaveLength(1);
    expect(stderr!.chunks).toHaveLength(1);
  });

  it('mergeStreamChunks handles multiple nodes', () => {
    useTerminalStreamStore
      .getState()
      .mergeStreamChunks([
        makeChunk({ nodeRef: 'node-1', chunkIndex: 1 }),
        makeChunk({ nodeRef: 'node-2', chunkIndex: 1 }),
      ]);

    expect(useTerminalStreamStore.getState().getTerminalSession('node-1', 'pty')).toBeDefined();
    expect(useTerminalStreamStore.getState().getTerminalSession('node-2', 'pty')).toBeDefined();
  });

  // --- getTerminalSession ---

  it('getTerminalSession returns undefined for unknown session', () => {
    expect(useTerminalStreamStore.getState().getTerminalSession('unknown', 'pty')).toBeUndefined();
  });

  it('getTerminalSession defaults to pty stream', () => {
    useTerminalStreamStore
      .getState()
      .mergeStreamChunks([makeChunk({ nodeRef: 'node-1', stream: 'pty', chunkIndex: 1 })]);
    const session = useTerminalStreamStore.getState().getTerminalSession('node-1');
    expect(session).toBeDefined();
    expect(session!.stream).toBe('pty');
  });

  // --- resetTerminalStreams ---

  it('resetTerminalStreams clears all state', () => {
    useTerminalStreamStore.getState().mergeStreamChunks([makeChunk()], 'cursor-1');
    useTerminalStreamStore.getState().resetTerminalStreams();
    const state = useTerminalStreamStore.getState();
    expect(state.terminalStreams).toEqual({});
    expect(state.terminalCursor).toBeNull();
  });
});
