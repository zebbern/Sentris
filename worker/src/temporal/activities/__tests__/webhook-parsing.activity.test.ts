import { describe, it, expect, beforeEach, mock, vi } from 'bun:test';

// ── Mock component-sdk runner ────────────────────────────────────────────────
const mockRunComponentWithRunner = vi.fn();
const mockCreateExecutionContext = vi.fn().mockReturnValue({
  runId: 'webhook-parse-test',
  componentRef: 'webhook.parse',
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
});

mock.module('@sentris/component-sdk', () => ({
  createExecutionContext: mockCreateExecutionContext,
  runComponentWithRunner: mockRunComponentWithRunner,
}));

// Import AFTER mock
import { executeWebhookParsingScriptActivity } from '../webhook-parsing.activity';

// ── Tests ────────────────────────────────────────────────────────────────────

const originalDebugWorkflow = process.env.SENTRIS_DEBUG_WORKFLOW;

describe('executeWebhookParsingScriptActivity', () => {
  beforeEach(() => {
    delete process.env.SENTRIS_DEBUG_WORKFLOW;
    mockRunComponentWithRunner.mockReset();
    mockCreateExecutionContext.mockClear();
    mockCreateExecutionContext.mockReturnValue({
      runId: 'webhook-parse-test',
      componentRef: 'webhook.parse',
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    });
  });
  it('calls runComponentWithRunner with a Docker runner config', async () => {
    const parsedOutput = { event: 'push', repo: 'test-repo' };
    mockRunComponentWithRunner.mockResolvedValue(parsedOutput);

    const result = await executeWebhookParsingScriptActivity({
      parsingScript: 'export async function script(input) { return input.payload; }',
      payload: { action: 'push', repository: 'test' },
      headers: { 'content-type': 'application/json' },
    });

    expect(result).toEqual(parsedOutput);
    expect(mockRunComponentWithRunner).toHaveBeenCalledTimes(1);

    const [runnerConfig] = mockRunComponentWithRunner.mock.calls[0];
    expect(runnerConfig.kind).toBe('docker');
    expect(runnerConfig.image).toBe('oven/bun:alpine');
    expect(runnerConfig.entrypoint).toBe('sh');
    expect(runnerConfig.network).toBe('bridge');
  });

  it('uses default timeout of 30 seconds when not specified', async () => {
    mockRunComponentWithRunner.mockResolvedValue({});

    await executeWebhookParsingScriptActivity({
      parsingScript: 'export async function script() { return {}; }',
      payload: {},
      headers: {},
    });

    const [runnerConfig] = mockRunComponentWithRunner.mock.calls[0];
    expect(runnerConfig.timeoutSeconds).toBe(30);
  });

  it('uses custom timeout when specified', async () => {
    mockRunComponentWithRunner.mockResolvedValue({});

    await executeWebhookParsingScriptActivity({
      parsingScript: 'export async function script() { return {}; }',
      payload: {},
      headers: {},
      timeoutSeconds: 60,
    });

    const [runnerConfig] = mockRunComponentWithRunner.mock.calls[0];
    expect(runnerConfig.timeoutSeconds).toBe(60);
  });

  it('auto-prepends export keyword to script function if missing', async () => {
    mockRunComponentWithRunner.mockResolvedValue({});

    await executeWebhookParsingScriptActivity({
      parsingScript: 'async function script(input) { return input.payload; }',
      payload: { data: 'test' },
      headers: {},
    });

    // The params passed to runComponentWithRunner should have the processed script
    const [, , params] = mockRunComponentWithRunner.mock.calls[0];
    expect(params.code).toContain('export');
  });

  it('passes payload and headers in runner params', async () => {
    mockRunComponentWithRunner.mockResolvedValue({});

    const payload = { event: 'issue', action: 'opened' };
    const headers = { 'x-github-event': 'issues' };

    await executeWebhookParsingScriptActivity({
      parsingScript: 'export async function script(input) { return {}; }',
      payload,
      headers,
    });

    const [, , params] = mockRunComponentWithRunner.mock.calls[0];
    expect(params.payload).toEqual(payload);
    expect(params.headers).toEqual(headers);
  });

  it('creates execution context with webhook-specific runId and ref', async () => {
    mockRunComponentWithRunner.mockResolvedValue({});

    await executeWebhookParsingScriptActivity({
      parsingScript: 'export async function script() { return {}; }',
      payload: {},
      headers: {},
    });

    expect(mockCreateExecutionContext).toHaveBeenCalledWith(
      expect.objectContaining({
        componentRef: 'webhook.parse',
      }),
    );

    const ctxArg = mockCreateExecutionContext.mock.calls[0][0];
    expect(ctxArg.runId).toContain('webhook-parse-');
  });

  it('does not mirror parser info/debug collector logs to console by default', async () => {
    mockRunComponentWithRunner.mockResolvedValue({});
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    try {
      await executeWebhookParsingScriptActivity({
        parsingScript: 'export async function script() { return {}; }',
        payload: {},
        headers: {},
      });

      const ctxArg = mockCreateExecutionContext.mock.calls[0][0];
      ctxArg.logCollector({ level: 'info', message: 'parser started' });
      ctxArg.logCollector({ level: 'debug', message: 'parser details' });

      expect(consoleLogSpy).not.toHaveBeenCalled();
      expect(consoleDebugSpy).not.toHaveBeenCalled();
    } finally {
      if (originalDebugWorkflow === undefined) {
        delete process.env.SENTRIS_DEBUG_WORKFLOW;
      } else {
        process.env.SENTRIS_DEBUG_WORKFLOW = originalDebugWorkflow;
      }
    }
  });
});
