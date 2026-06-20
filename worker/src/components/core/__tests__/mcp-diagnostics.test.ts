import { afterEach, describe, expect, test, vi } from 'bun:test';
import { mcpDiagnosticLog } from '../mcp-diagnostics';

const originalDebugWorkflow = process.env.SENTRIS_DEBUG_WORKFLOW;

afterEach(() => {
  if (originalDebugWorkflow === undefined) {
    delete process.env.SENTRIS_DEBUG_WORKFLOW;
  } else {
    process.env.SENTRIS_DEBUG_WORKFLOW = originalDebugWorkflow;
  }
  vi.restoreAllMocks();
});

describe('mcpDiagnosticLog', () => {
  test('does not mirror diagnostics by default', () => {
    delete process.env.SENTRIS_DEBUG_WORKFLOW;
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    mcpDiagnosticLog('quiet');

    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  test('mirrors diagnostics when workflow debugging is enabled', () => {
    process.env.SENTRIS_DEBUG_WORKFLOW = '1';
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    mcpDiagnosticLog('visible', { detail: true });

    expect(consoleLogSpy).toHaveBeenCalledWith('visible', { detail: true });
  });
});
