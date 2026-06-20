import { describe, expect, it, vi } from 'bun:test';
import { createMockLogCollector, createMockTrace } from '../test-utils';

describe('worker test utilities', () => {
  it('only mirrors trace and log events to console when test diagnostics are enabled', async () => {
    const previousDebugValue = process.env.SENTRIS_DEBUG_TESTS;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      delete process.env.SENTRIS_DEBUG_TESTS;

      createMockTrace().record({
        type: 'NODE_STARTED',
        nodeRef: 'node-1',
        message: 'started',
      });
      await createMockLogCollector().append({
        level: 'info',
        message: 'hello',
      });

      expect(logSpy).not.toHaveBeenCalled();

      process.env.SENTRIS_DEBUG_TESTS = '1';

      createMockTrace().record({
        type: 'NODE_COMPLETED',
        nodeRef: 'node-2',
        message: 'finished',
      });
      await createMockLogCollector().append({
        level: 'warn',
        message: 'careful',
      });

      expect(logSpy).toHaveBeenCalledWith('TRACE:', 'NODE_COMPLETED', 'node-2', 'finished');
      expect(logSpy).toHaveBeenCalledWith('LOG:', 'warn', 'careful');
    } finally {
      logSpy.mockRestore();
      if (previousDebugValue === undefined) {
        delete process.env.SENTRIS_DEBUG_TESTS;
      } else {
        process.env.SENTRIS_DEBUG_TESTS = previousDebugValue;
      }
    }
  });
});
