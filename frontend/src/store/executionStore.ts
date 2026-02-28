/**
 * Re-export from the execution/ directory for backward compatibility.
 *
 * All execution store logic has been split into focused modules:
 * - execution/executionLifecycleStore.ts — run lifecycle, polling, SSE streaming
 * - execution/terminalStreamStore.ts     — terminal chunk state
 * - execution/executionLogStore.ts       — log management
 * - execution/types.ts                   — shared types
 * - execution/helpers.ts                 — pure helpers & constants
 */
export * from './execution';
