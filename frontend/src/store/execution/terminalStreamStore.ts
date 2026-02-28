import { create } from 'zustand';
import { queryClient } from '@/lib/queryClient';
import { logger } from '@/lib/logger';
import { executionTerminalChunksOptions } from '@/lib/executionQueryOptions';
import type { TerminalStreamChunk, TerminalStreamState } from './types';
import { MAX_TERMINAL_CHUNKS, terminalKey } from './helpers';

// ---------------------------------------------------------------------------
// State & Actions
// ---------------------------------------------------------------------------

interface TerminalStreamStoreState {
  terminalStreams: Record<string, TerminalStreamState>;
  terminalCursor: string | null;
}

interface TerminalStreamStoreActions {
  /** Fetch initial terminal chunks for a node from the API. */
  prefetchTerminal: (
    nodeId: string,
    stream?: 'pty' | 'stdout' | 'stderr',
    runIdOverride?: string | null,
  ) => Promise<void>;
  /** Return the cached terminal session for a node + stream combo. */
  getTerminalSession: (
    nodeId: string,
    stream?: 'pty' | 'stdout' | 'stderr',
  ) => TerminalStreamState | undefined;
  /** Merge incoming terminal chunks from SSE into the store. */
  mergeStreamChunks: (chunks: TerminalStreamChunk[], cursor?: string | null) => void;
  /** Reset all terminal state. */
  resetTerminalStreams: () => void;
}

type TerminalStreamStore = TerminalStreamStoreState & TerminalStreamStoreActions;

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const INITIAL_TERMINAL_STATE: TerminalStreamStoreState = {
  terminalStreams: {},
  terminalCursor: null,
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useTerminalStreamStore = create<TerminalStreamStore>((set, get) => ({
  ...INITIAL_TERMINAL_STATE,

  prefetchTerminal: async (
    nodeId: string,
    stream: 'pty' | 'stdout' | 'stderr' = 'pty',
    runIdOverride?: string | null,
  ) => {
    // runId must be resolved by the caller — we accept an explicit override
    // or fall back to the execution lifecycle store's current runId.
    const runId = runIdOverride ?? null;
    if (!runId) return;

    const key = terminalKey(nodeId, stream);
    if (get().terminalStreams[key]?.chunks.length) {
      return;
    }

    try {
      const result = await queryClient.fetchQuery(
        executionTerminalChunksOptions(runId, nodeId, stream),
      );
      if (!result?.chunks || result.chunks.length === 0) {
        return;
      }

      set((state) => {
        const streams = { ...state.terminalStreams };
        for (const chunk of result.chunks!) {
          const chunkKey = terminalKey(chunk.nodeRef, chunk.stream);
          const existing = streams[chunkKey] ?? {
            nodeRef: chunk.nodeRef,
            stream: chunk.stream,
            cursor: null,
            chunks: [],
            lastChunkIndex: 0,
          };
          if (chunk.chunkIndex <= existing.lastChunkIndex) {
            continue;
          }
          const merged = [...existing.chunks, chunk];
          const trimmed =
            merged.length > MAX_TERMINAL_CHUNKS ? merged.slice(-MAX_TERMINAL_CHUNKS) : merged;
          streams[chunkKey] = {
            ...existing,
            chunks: trimmed,
            lastChunkIndex: chunk.chunkIndex,
            cursor: result.cursor ?? existing.cursor ?? null,
          };
        }
        return {
          terminalStreams: streams,
          terminalCursor: result.cursor ?? state.terminalCursor,
        };
      });
    } catch (error: unknown) {
      logger.error('Failed to fetch terminal chunks', error);
    }
  },

  getTerminalSession: (nodeId: string, stream: 'pty' | 'stdout' | 'stderr' = 'pty') => {
    const key = terminalKey(nodeId, stream);
    return get().terminalStreams[key];
  },

  mergeStreamChunks: (chunks: TerminalStreamChunk[], cursor?: string | null) => {
    if (chunks.length === 0) return;

    set((state) => {
      const streams = { ...state.terminalStreams };

      for (const chunk of chunks) {
        const key = terminalKey(chunk.nodeRef, chunk.stream);
        const existing = streams[key] ?? {
          nodeRef: chunk.nodeRef,
          stream: chunk.stream,
          cursor: null,
          chunks: [],
          lastChunkIndex: 0,
        };
        if (chunk.chunkIndex <= existing.lastChunkIndex) {
          continue;
        }
        const merged = [...existing.chunks, chunk];
        const trimmed =
          merged.length > MAX_TERMINAL_CHUNKS ? merged.slice(-MAX_TERMINAL_CHUNKS) : merged;
        streams[key] = {
          ...existing,
          chunks: trimmed,
          lastChunkIndex: chunk.chunkIndex,
        };
      }

      return {
        terminalStreams: streams,
        terminalCursor: cursor ?? state.terminalCursor,
      };
    });
  },

  resetTerminalStreams: () => {
    set(INITIAL_TERMINAL_STATE);
  },
}));
