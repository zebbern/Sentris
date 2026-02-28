import type { ExecutionLog, ExecutionStatus } from '@/schemas/execution';
import type { NodeStatus } from '@/schemas/node';
import type { ExecutionLifecycle } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MAX_TERMINAL_CHUNKS = 500;
export const MAX_TRACKED_RUNS = 10;

// ---------------------------------------------------------------------------
// Pure helpers shared across execution stores
// ---------------------------------------------------------------------------

export const terminalKey = (nodeId: string, stream = 'pty') => `${nodeId}:${stream}`;

export const mapStatusToLifecycle = (status: ExecutionStatus | undefined): ExecutionLifecycle => {
  switch (status) {
    case 'QUEUED':
      return 'queued';
    case 'RUNNING':
      return 'running';
    case 'COMPLETED':
      return 'completed';
    case 'FAILED':
      return 'failed';
    case 'CANCELLED':
    case 'TERMINATED':
      return 'cancelled';
    case 'TIMED_OUT':
      return 'failed';
    default:
      return 'idle';
  }
};

/**
 * Merge two arrays of ExecutionLog entries by deduplicating on `id`.
 * Incoming entries that already exist (by id) are dropped.
 */
export const mergeById = (existing: ExecutionLog[], incoming: ExecutionLog[]): ExecutionLog[] => {
  if (incoming.length === 0) return existing;
  const seen = new Set(existing.map((event) => event.id));
  const deduped = incoming.filter((event) => {
    if (seen.has(event.id)) return false;
    seen.add(event.id);
    return true;
  });
  if (deduped.length === 0) return existing;
  return [...existing, ...deduped];
};

export const mergeEvents = mergeById;
export const mergeLogEntries = mergeById;

export const deriveNodeStates = (events: ExecutionLog[]): Record<string, NodeStatus> => {
  const states: Record<string, NodeStatus> = {};
  for (const event of events) {
    if (!event.nodeId) continue;
    switch (event.type) {
      case 'STARTED':
        states[event.nodeId] = 'running';
        break;
      case 'PROGRESS':
        if (!states[event.nodeId]) {
          states[event.nodeId] = 'running';
        }
        break;
      case 'COMPLETED':
        states[event.nodeId] = 'success';
        break;
      case 'FAILED':
        states[event.nodeId] = 'error';
        break;
      default:
        break;
    }
  }
  return states;
};
