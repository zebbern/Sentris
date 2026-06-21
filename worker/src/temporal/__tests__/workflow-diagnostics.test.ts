import { describe, expect, test } from 'bun:test';

import { shouldLogWorkflowDiagnostics } from '../workflow-diagnostics';

describe('workflow diagnostics', () => {
  test('does not throw when process is unavailable in the workflow sandbox', () => {
    const originalProcess = (globalThis as { process?: unknown }).process;

    try {
      Reflect.deleteProperty(globalThis, 'process');

      expect(() => shouldLogWorkflowDiagnostics()).not.toThrow();
      expect(shouldLogWorkflowDiagnostics()).toBe(false);
    } finally {
      (globalThis as { process?: unknown }).process = originalProcess;
    }
  });
});
