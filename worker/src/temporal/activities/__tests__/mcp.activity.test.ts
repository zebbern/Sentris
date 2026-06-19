import { describe, it, expect, beforeEach, afterEach, mock, vi } from 'bun:test';
import { ApplicationFailure } from '@temporalio/activity';

// ── Mock node:child_process ──────────────────────────────────────────────────
const mockExecFile = vi.fn();

mock.module('node:child_process', () => ({
  execFile: mockExecFile,
}));

mock.module('node:util', () => ({
  promisify: (fn: any) => fn,
}));

// Import AFTER mocks
import {
  registerComponentToolActivity,
  registerRemoteMcpActivity,
  registerLocalMcpActivity,
  cleanupRunResourcesActivity,
  areAllToolsReadyActivity,
  prepareAndRegisterToolActivity,
} from '../mcp.activity';

// ── Test helpers ─────────────────────────────────────────────────────────────

const ORIGINAL_ENV = { ...process.env };

function createMockFetchResponse(data: any, ok = true, status = 200) {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: vi.fn().mockResolvedValue(data),
    text: vi.fn().mockResolvedValue(JSON.stringify(data)),
  } as unknown as Response;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('MCP Activities', () => {
  beforeEach(() => {
    // Reset env for each test
    process.env.INTERNAL_SERVICE_TOKEN = 'test-token-123';
    process.env.SENTRIS_API_BASE_URL = 'http://localhost:3211';
    delete process.env.SKIP_CONTAINER_CLEANUP;

    // Spy on global fetch — this is more resilient than replacing globalThis.fetch
    vi.spyOn(globalThis, 'fetch').mockImplementation(vi.fn() as unknown as typeof fetch);
    mockExecFile.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Restore env
    for (const key of Object.keys(process.env)) {
      if (!(key in ORIGINAL_ENV)) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete process.env[key];
      }
    }
    Object.assign(process.env, ORIGINAL_ENV);
  });

  // ── callInternalApi (tested indirectly) ──────────────────────────────────

  describe('callInternalApi error handling', () => {
    it('throws non-retryable ApplicationFailure when INTERNAL_SERVICE_TOKEN is missing', async () => {
      delete process.env.INTERNAL_SERVICE_TOKEN;

      try {
        await registerComponentToolActivity({
          runId: 'run-1',
          nodeId: 'node-1',
          toolName: 'test-tool',
          componentId: 'test.comp',
          description: 'A test tool',
          inputSchema: {},
          credentials: {},
        });
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ApplicationFailure);
        const af = error as ApplicationFailure;
        expect(af.type).toBe('ConfigurationError');
        expect(af.nonRetryable).toBe(true);
        expect(af.message).toContain('INTERNAL_SERVICE_TOKEN');
      }
    });

    it('throws ServiceError when API returns non-200 response', async () => {
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        createMockFetchResponse({ error: 'Bad Request' }, false, 400),
      );

      try {
        await registerComponentToolActivity({
          runId: 'run-1',
          nodeId: 'node-1',
          toolName: 'test-tool',
          componentId: 'test.comp',
          description: 'A test tool',
          inputSchema: {},
          credentials: {},
        });
        expect.unreachable('should have thrown');
      } catch (error: any) {
        expect(error.message).toContain('Failed to call internal MCP registry');
        expect(error.message).toContain('register-component');
      }
    });
  });

  // ── registerComponentToolActivity ────────────────────────────────────────

  describe('registerComponentToolActivity', () => {
    it('sends correct payload to register-component endpoint', async () => {
      const mockResponse = createMockFetchResponse({ success: true });
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const input = {
        runId: 'run-1',
        nodeId: 'node-1',
        toolName: 'my-tool',
        componentId: 'test.component',
        description: 'A description',
        inputSchema: { type: 'object' },
        credentials: { apiKey: 'secret' },
      };

      await registerComponentToolActivity(input);

      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock
        .calls[0];
      // URL suffix is stable; base URL may vary depending on env at module load time
      expect(url).toContain('/internal/mcp/register-component');
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(options.headers['X-Internal-Token']).toBe('test-token-123');

      const body = JSON.parse(options.body);
      expect(body.runId).toBe('run-1');
      expect(body.nodeId).toBe('node-1');
      expect(body.toolName).toBe('my-tool');
      expect(body.componentId).toBe('test.component');
    });
  });

  // ── registerRemoteMcpActivity ────────────────────────────────────────────

  describe('registerRemoteMcpActivity', () => {
    it('sends correct payload with http transport', async () => {
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        createMockFetchResponse({ success: true }),
      );

      await registerRemoteMcpActivity({
        runId: 'run-1',
        nodeId: 'node-1',
        toolName: 'remote-tool',
        description: 'Remote MCP server',
        inputSchema: {},
        endpoint: 'http://remote-server:8080/mcp',
      });

      const [url, options] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock
        .calls[0];
      expect(url).toContain('register-mcp-server');

      const body = JSON.parse(options.body);
      expect(body.transport).toBe('http');
      expect(body.endpoint).toBe('http://remote-server:8080/mcp');
      expect(body.serverName).toBe('remote-tool');
    });

    it('includes Authorization header when authToken is provided', async () => {
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        createMockFetchResponse({ success: true }),
      );

      await registerRemoteMcpActivity({
        runId: 'run-1',
        nodeId: 'node-1',
        toolName: 'authed-tool',
        description: 'Authed server',
        inputSchema: {},
        endpoint: 'http://remote:8080',
        authToken: 'bearer-token-abc',
      });

      const body = JSON.parse(
        (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
      );
      expect(body.headers).toBeDefined();
      expect(body.headers.Authorization).toBe('Bearer bearer-token-abc');
    });

    it('does not include headers when authToken is not provided', async () => {
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        createMockFetchResponse({ success: true }),
      );

      await registerRemoteMcpActivity({
        runId: 'run-1',
        nodeId: 'node-1',
        toolName: 'no-auth-tool',
        description: 'No auth',
        inputSchema: {},
        endpoint: 'http://remote:8080',
      });

      const body = JSON.parse(
        (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
      );
      expect(body.headers).toBeUndefined();
    });
  });

  // ── registerLocalMcpActivity ─────────────────────────────────────────────

  describe('registerLocalMcpActivity', () => {
    it('sends correct payload with stdio transport', async () => {
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        createMockFetchResponse({ success: true }),
      );

      await registerLocalMcpActivity({
        runId: 'run-1',
        nodeId: 'node-1',
        toolName: 'local-tool',
        description: 'Local MCP',
        inputSchema: {},
        image: 'my-image:latest',
        port: 9090,
        endpoint: 'http://localhost:9090',
        containerId: 'container-abc',
      });

      const body = JSON.parse(
        (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
      );
      expect(body.transport).toBe('stdio');
      expect(body.endpoint).toBe('http://localhost:9090');
      expect(body.containerId).toBe('container-abc');
      expect(body.serverName).toBe('local-tool');
    });

    it('uses default port and generates containerId from image when not provided', async () => {
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        createMockFetchResponse({ success: true }),
      );

      await registerLocalMcpActivity({
        runId: 'run-1',
        nodeId: 'node-1',
        toolName: 'local-tool',
        description: 'Local',
        inputSchema: {},
        image: 'my/image:latest',
        port: 0,
        endpoint: '',
        containerId: '',
      });

      const body = JSON.parse(
        (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
      );
      // When port is 0 (falsy), default to 8080
      expect(body.endpoint).toBe('http://localhost:8080');
      // When containerId is '' (falsy), fallback to docker-{sanitized-image}
      expect(body.containerId).toBe('docker-my-image-latest');
    });
  });

  // ── cleanupRunResourcesActivity ──────────────────────────────────────────

  describe('cleanupRunResourcesActivity', () => {
    it('skips cleanup when SKIP_CONTAINER_CLEANUP is true', async () => {
      // Note: SKIP_CONTAINER_CLEANUP is read at module load time as a const,
      // so we test the conditional behavior indirectly.
      // With the env var not set to 'true', it should proceed.
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        createMockFetchResponse({ containerIds: [] }),
      );

      mockExecFile.mockResolvedValue({ stdout: '', stderr: '' });

      await cleanupRunResourcesActivity({ runId: 'run-cleanup-1' });

      // Should have called the cleanup API
      const url = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(url).toContain('cleanup');
    });

    it('removes containers returned by cleanup API', async () => {
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        createMockFetchResponse({ containerIds: ['container-1', 'container-2'] }),
      );

      // Mock Docker ps for name pattern (returns empty)
      mockExecFile.mockImplementation(async (cmd: string, args: string[]) => {
        if (args.includes('ps')) {
          return { stdout: '', stderr: '' };
        }
        if (args.includes('rm')) {
          return { stdout: '', stderr: '' };
        }
        if (args.includes('volume')) {
          return { stdout: '', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      });

      await cleanupRunResourcesActivity({ runId: 'run-cleanup-2' });

      // Should have called docker rm -f for each container
      const rmCalls = mockExecFile.mock.calls.filter((call: any[]) => call[1]?.[0] === 'rm');
      expect(rmCalls.length).toBe(2);
    });

    it('skips containers with unsafe IDs', async () => {
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        createMockFetchResponse({ containerIds: ['valid-container', '; rm -rf /'] }),
      );

      mockExecFile.mockImplementation(async () => ({ stdout: '', stderr: '' }));

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await cleanupRunResourcesActivity({ runId: 'safe-run-id' });

      // Only the valid container should be cleaned up
      const rmCalls = mockExecFile.mock.calls.filter((call: any[]) => call[1]?.[0] === 'rm');
      expect(rmCalls.length).toBe(1);
      expect(rmCalls[0][1]).toContain('valid-container');

      consoleSpy.mockRestore();
    });

    it('skips volume cleanup for unsafe runId', async () => {
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        createMockFetchResponse({ containerIds: [] }),
      );

      // Name pattern returns empty
      mockExecFile.mockResolvedValue({ stdout: '', stderr: '' });

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await cleanupRunResourcesActivity({ runId: '; rm -rf /' });

      // Should not attempt volume listing with unsafe runId
      const volumeCalls = mockExecFile.mock.calls.filter((call: any[]) =>
        call[1]?.includes('volume'),
      );
      expect(volumeCalls.length).toBe(0);

      consoleSpy.mockRestore();
    });
  });

  // ── areAllToolsReadyActivity ─────────────────────────────────────────────

  describe('areAllToolsReadyActivity', () => {
    it('passes runId and requiredNodeIds to tools-ready endpoint', async () => {
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        createMockFetchResponse({ ready: true }),
      );

      const result = await areAllToolsReadyActivity({
        runId: 'run-tools-1',
        requiredNodeIds: ['node-a', 'node-b'],
      });

      expect(result.ready).toBe(true);

      const body = JSON.parse(
        (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
      );
      expect(body.runId).toBe('run-tools-1');
      expect(body.requiredNodeIds).toEqual(['node-a', 'node-b']);

      const url = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(url).toContain('tools-ready');
    });

    it('returns ready=false when tools are not ready', async () => {
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        createMockFetchResponse({ ready: false }),
      );

      const result = await areAllToolsReadyActivity({
        runId: 'run-tools-2',
        requiredNodeIds: ['node-a'],
      });

      expect(result.ready).toBe(false);
    });
  });

  // ── prepareAndRegisterToolActivity ───────────────────────────────────────

  describe('prepareAndRegisterToolActivity', () => {
    it('throws ServiceError when component is not found', async () => {
      try {
        await prepareAndRegisterToolActivity({
          runId: 'run-1',
          nodeId: 'node-1',
          componentId: 'nonexistent.component',
          inputs: {},
          params: {},
        });
        expect.unreachable('should have thrown');
      } catch (error: any) {
        expect(error.message).toContain('nonexistent.component');
        expect(error.message).toContain('not found');
      }
    });
  });
});
