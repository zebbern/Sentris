import { describe, it, expect, mock } from 'bun:test';

// ---------------------------------------------------------------------------
// Mock authStore so queryKeys can resolve org/user scopes
// ---------------------------------------------------------------------------
mock.module('@/store/authStore', () => ({
  useAuthStore: {
    getState: () => ({
      organizationId: 'test-org',
      userId: 'test-user',
    }),
  },
}));

// Mock the API module — we only care about the shape of returned objects,
// not executing actual HTTP calls.
mock.module('@/services/api', () => ({
  api: {
    executions: {
      getStatus: mock(() => Promise.resolve({})),
      getTrace: mock(() => Promise.resolve({})),
      getEvents: mock(() => Promise.resolve({})),
      getDataFlows: mock(() => Promise.resolve({})),
      getTerminalChunks: mock(() => Promise.resolve({})),
      listNodeIO: mock(() => Promise.resolve({})),
      getResult: mock(() => Promise.resolve({})),
      getRun: mock(() => Promise.resolve({})),
    },
  },
}));

import {
  executionStatusOptions,
  executionTraceOptions,
  executionEventsOptions,
  executionDataFlowsOptions,
  executionTerminalChunksOptions,
  executionNodeIOOptions,
  executionResultOptions,
  executionRunOptions,
} from '../executionQueryOptions';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('executionQueryOptions', () => {
  const RUN_ID = 'run-abc-123';

  // --- executionStatusOptions ---

  describe('executionStatusOptions', () => {
    it('returns an object with queryKey and queryFn', () => {
      const opts = executionStatusOptions(RUN_ID);
      expect(opts.queryKey).toBeDefined();
      expect(typeof opts.queryFn).toBe('function');
    });

    it('queryKey includes the runId', () => {
      const opts = executionStatusOptions(RUN_ID);
      expect(opts.queryKey).toContain(RUN_ID);
    });

    it('has staleTime 0 for polling', () => {
      const opts = executionStatusOptions(RUN_ID);
      expect(opts.staleTime).toBe(0);
    });

    it('has retry false', () => {
      const opts = executionStatusOptions(RUN_ID);
      expect(opts.retry).toBe(false);
    });
  });

  // --- executionTraceOptions ---

  describe('executionTraceOptions', () => {
    it('returns an object with queryKey and queryFn', () => {
      const opts = executionTraceOptions(RUN_ID);
      expect(opts.queryKey).toBeDefined();
      expect(typeof opts.queryFn).toBe('function');
    });

    it('queryKey includes the runId', () => {
      const opts = executionTraceOptions(RUN_ID);
      expect(opts.queryKey).toContain(RUN_ID);
    });

    it('has staleTime 0 for polling', () => {
      const opts = executionTraceOptions(RUN_ID);
      expect(opts.staleTime).toBe(0);
    });
  });

  // --- executionEventsOptions ---

  describe('executionEventsOptions', () => {
    it('returns an object with queryKey and queryFn', () => {
      const opts = executionEventsOptions(RUN_ID);
      expect(opts.queryKey).toBeDefined();
      expect(typeof opts.queryFn).toBe('function');
    });

    it('queryKey includes the runId', () => {
      const opts = executionEventsOptions(RUN_ID);
      expect(opts.queryKey).toContain(RUN_ID);
    });

    it('has staleTime 5000', () => {
      const opts = executionEventsOptions(RUN_ID);
      expect(opts.staleTime).toBe(5_000);
    });
  });

  // --- executionDataFlowsOptions ---

  describe('executionDataFlowsOptions', () => {
    it('returns an object with queryKey and queryFn', () => {
      const opts = executionDataFlowsOptions(RUN_ID);
      expect(opts.queryKey).toBeDefined();
      expect(typeof opts.queryFn).toBe('function');
    });

    it('queryKey includes the runId', () => {
      const opts = executionDataFlowsOptions(RUN_ID);
      expect(opts.queryKey).toContain(RUN_ID);
    });
  });

  // --- executionTerminalChunksOptions ---

  describe('executionTerminalChunksOptions', () => {
    it('returns an object with queryKey and queryFn', () => {
      const opts = executionTerminalChunksOptions(RUN_ID, 'node-ref', 'pty');
      expect(opts.queryKey).toBeDefined();
      expect(typeof opts.queryFn).toBe('function');
    });

    it('queryKey includes runId, nodeRef, and stream', () => {
      const opts = executionTerminalChunksOptions(RUN_ID, 'node-ref', 'stdout');
      expect(opts.queryKey).toContain(RUN_ID);
      expect(opts.queryKey).toContain('node-ref');
      expect(opts.queryKey).toContain('stdout');
    });

    it('has staleTime 10000', () => {
      const opts = executionTerminalChunksOptions(RUN_ID, 'n1', 'pty');
      expect(opts.staleTime).toBe(10_000);
    });
  });

  // --- executionNodeIOOptions ---

  describe('executionNodeIOOptions', () => {
    it('returns an object with queryKey and queryFn', () => {
      const opts = executionNodeIOOptions(RUN_ID);
      expect(opts.queryKey).toBeDefined();
      expect(typeof opts.queryFn).toBe('function');
    });

    it('queryKey includes the runId', () => {
      const opts = executionNodeIOOptions(RUN_ID);
      expect(opts.queryKey).toContain(RUN_ID);
    });

    it('uses longer staleTime when terminal', () => {
      const opts = executionNodeIOOptions(RUN_ID, true);
      expect(opts.staleTime).toBe(30_000);
    });

    it('uses shorter staleTime when not terminal', () => {
      const opts = executionNodeIOOptions(RUN_ID, false);
      expect(opts.staleTime).toBe(10_000);
    });
  });

  // --- executionResultOptions ---

  describe('executionResultOptions', () => {
    it('returns an object with queryKey and queryFn', () => {
      const opts = executionResultOptions(RUN_ID);
      expect(opts.queryKey).toBeDefined();
      expect(typeof opts.queryFn).toBe('function');
    });

    it('queryKey includes the runId', () => {
      const opts = executionResultOptions(RUN_ID);
      expect(opts.queryKey).toContain(RUN_ID);
    });

    it('uses Infinity staleTime when terminal', () => {
      const opts = executionResultOptions(RUN_ID, true);
      expect(opts.staleTime).toBe(Infinity);
    });

    it('uses 30s staleTime when not terminal', () => {
      const opts = executionResultOptions(RUN_ID, false);
      expect(opts.staleTime).toBe(30_000);
    });
  });

  // --- executionRunOptions ---

  describe('executionRunOptions', () => {
    it('returns an object with queryKey and queryFn', () => {
      const opts = executionRunOptions(RUN_ID);
      expect(opts.queryKey).toBeDefined();
      expect(typeof opts.queryFn).toBe('function');
    });

    it('queryKey includes the runId', () => {
      const opts = executionRunOptions(RUN_ID);
      expect(opts.queryKey).toContain(RUN_ID);
    });

    it('uses Infinity staleTime when terminal', () => {
      const opts = executionRunOptions(RUN_ID, true);
      expect(opts.staleTime).toBe(Infinity);
    });
  });

  // --- Cross-function key uniqueness ---

  it('different option factories produce unique queryKeys for same runId', () => {
    const keys = [
      executionStatusOptions(RUN_ID).queryKey,
      executionTraceOptions(RUN_ID).queryKey,
      executionEventsOptions(RUN_ID).queryKey,
      executionDataFlowsOptions(RUN_ID).queryKey,
      executionNodeIOOptions(RUN_ID).queryKey,
      executionResultOptions(RUN_ID).queryKey,
      executionRunOptions(RUN_ID).queryKey,
    ];

    // Each key's first element (domain) should be unique
    const domains = keys.map((k) => k[0]);
    const uniqueDomains = new Set(domains);
    expect(uniqueDomains.size).toBe(keys.length);
  });
});
