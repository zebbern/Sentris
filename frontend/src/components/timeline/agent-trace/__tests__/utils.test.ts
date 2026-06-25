import { describe, expect, it } from 'bun:test';

import { deriveAgentSteps } from '../utils';
import type { AgentTraceChunk } from '../types';

describe('deriveAgentSteps', () => {
  it('turns data-tool-error chunks into completed failed tool steps', () => {
    const parts: AgentTraceChunk[] = [
      {
        sequence: 1,
        timestamp: '2026-01-01T00:00:00.000Z',
        chunk: {
          type: 'tool-input-available',
          toolCallId: 'call-fetch',
          toolName: 'Fetch_Reference__fetch',
          input: { url: 'https://example.com' },
        } as any,
      },
      {
        sequence: 2,
        timestamp: '2026-01-01T00:00:02.000Z',
        chunk: {
          type: 'data-tool-error',
          toolCallId: 'call-fetch',
          toolName: 'Fetch_Reference__fetch',
          error: 'Connection failed: Failed to parse JSON',
        } as any,
      },
    ];

    expect(deriveAgentSteps(parts)).toEqual([
      expect.objectContaining({
        key: 'tool-call-fetch',
        toolCallId: 'call-fetch',
        toolName: 'Fetch_Reference__fetch',
        toolInput: { url: 'https://example.com' },
        toolError: 'Connection failed: Failed to parse JSON',
        finishReason: 'error',
        isComplete: true,
        durationMs: 2000,
      }),
    ]);
  });
});
