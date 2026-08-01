import { describe, expect, mock, test } from 'bun:test';
import type {
  McpRuntimeAcquireRequest,
  McpRuntimeFence,
  McpRuntimeKey,
  McpRuntimeRef,
} from '@sentris/shared';

import { MCP_RUNTIME_INTERNAL_AUTH_HEADER } from '../mcp-runtime-auth';
import {
  startMcpRuntimeInternalServer,
  type McpRuntimeInternalServerLogger,
} from '../mcp-runtime-internal.server';
import { McpRuntimeFenceLostError, type McpRuntimeManager } from '../mcp-runtime-manager';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const RUNTIME_ID = '10000000-0000-4000-8000-000000000001';
const OWNER_EPOCH = '20000000-0000-4000-8000-000000000002';
const INTERNAL_TOKEN = 'runtime-internal-test-token';
const HOLDER_ID = '40000000-0000-4000-8000-000000000004';

const processIdentity: McpRuntimeAcquireRequest['candidateOwner'] = {
  ownerId: 'worker-0',
  ownerEpoch: OWNER_EPOCH,
  ownerAddress: 'http://worker-0.internal:9301',
};
const runtimeKey: McpRuntimeKey = {
  sourceId: 'saved-server-1',
  transport: 'http',
  configFingerprint: HASH_A,
  organizationId: 'org-1',
  principalPartitionHash: HASH_B,
  credentialReference: 'credential-1',
  credentialGeneration: 2,
};
const fence: McpRuntimeFence = {
  runtimeId: RUNTIME_ID,
  ownerId: processIdentity.ownerId,
  ownerEpoch: processIdentity.ownerEpoch,
  leaseGeneration: 4,
};

describe('MCP runtime internal server', () => {
  test('reports whether the owner listener is still accepting direct requests', async () => {
    const server = await startMcpRuntimeInternalServer({
      manager: managerStub(),
      token: INTERNAL_TOKEN,
      host: '127.0.0.1',
      port: 0,
      logger: collectingLogger([]),
    });

    await expect(server.checkReadiness()).resolves.toBeUndefined();
    await server.close();
    await expect(server.checkReadiness()).rejects.toThrow('not listening');
  });

  test('requires internal authentication before parsing or dispatching', async () => {
    const acquire = mock(async () => readyRef());
    await withServer({ manager: managerStub({ acquire }) }, async (baseUrl) => {
      const missing = await post(baseUrl, '/mcp-runtime/acquire', {
        runtimeKey,
        candidateOwner: processIdentity,
      });
      const wrong = await post(
        baseUrl,
        '/mcp-runtime/acquire',
        { runtimeKey, candidateOwner: processIdentity },
        'incorrect-runtime-token',
      );

      expect(missing.status).toBe(401);
      expect(wrong.status).toBe(401);
      expect(acquire).not.toHaveBeenCalled();
    });
  });

  test('accepts acquire as an unfenced runtime key plus candidate and rejects a fence extra', async () => {
    const acquire = mock(async () => readyRef());
    await withServer({ manager: managerStub({ acquire }) }, async (baseUrl) => {
      const accepted = await post(
        baseUrl,
        '/mcp-runtime/acquire',
        { runtimeKey, candidateOwner: processIdentity },
        INTERNAL_TOKEN,
      );
      const rejected = await post(
        baseUrl,
        '/mcp-runtime/acquire',
        { runtimeKey, candidateOwner: processIdentity, fence },
        INTERNAL_TOKEN,
      );

      expect(accepted.status).toBe(200);
      expect(await accepted.json()).toEqual(readyRef());
      expect(rejected.status).toBe(400);
      expect(acquire).toHaveBeenCalledTimes(1);
      expect(acquire).toHaveBeenCalledWith(runtimeKey, processIdentity);
    });
  });

  test('registers a fenced holder before owner-routed operations', async () => {
    const retain = mock(() => undefined);
    await withServer({ manager: managerStub({ retain }) }, async (baseUrl) => {
      const response = await post(
        baseUrl,
        '/mcp-runtime/retain',
        { fence, holderId: HOLDER_ID },
        INTERNAL_TOKEN,
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ retained: true });
      expect(retain).toHaveBeenCalledWith(fence, HOLDER_ID);
    });
  });

  test('touches owner-local holder liveness without invoking lease renewal', async () => {
    const touch = mock(() => readyRef());
    const renew = mock(async () => readyRef());
    await withServer({ manager: managerStub({ touch, renew }) }, async (baseUrl) => {
      const response = await post(
        baseUrl,
        '/mcp-runtime/touch',
        { fence, holderId: HOLDER_ID },
        INTERNAL_TOKEN,
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(readyRef());
      expect(touch).toHaveBeenCalledWith(fence, HOLDER_ID);
      expect(renew).not.toHaveBeenCalled();
    });
  });

  test('strict request schemas reject secret-bearing extras without logging them', async () => {
    const invoke = mock(async () => ({}));
    const logEntries: Record<string, unknown>[] = [];
    const secret = 'Bearer should-not-cross-the-runtime-boundary';
    await withServer(
      {
        manager: managerStub({ invoke }),
        logger: collectingLogger(logEntries),
      },
      async (baseUrl) => {
        const response = await post(
          baseUrl,
          '/mcp-runtime/invoke',
          {
            fence,
            holderId: HOLDER_ID,
            name: 'search',
            args: {},
            context: { idleTimeoutMs: 1_000, maxTotalTimeoutMs: 5_000 },
            resolvedHeaders: { Authorization: secret },
          },
          INTERNAL_TOKEN,
        );

        expect(response.status).toBe(400);
        expect(invoke).not.toHaveBeenCalled();
        expect(JSON.stringify(logEntries)).not.toContain(secret);
      },
    );
  });

  test('maps a stale full fence to a bounded 409 response', async () => {
    const discover = mock(async () => {
      throw new McpRuntimeFenceLostError();
    });
    await withServer({ manager: managerStub({ discover }) }, async (baseUrl) => {
      const response = await post(
        baseUrl,
        '/mcp-runtime/discover',
        { fence, holderId: HOLDER_ID },
        INTERNAL_TOKEN,
      );
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(409);
      expect(body).toMatchObject({
        error: 'MCP runtime fence is stale',
        code: 'MCP_RUNTIME_FENCE_LOST',
      });
      expect(discover).toHaveBeenCalledWith(fence, HOLDER_ID);
    });
  });

  test('rejects a request body above the configured bound before dispatch', async () => {
    const acquire = mock(async () => readyRef());
    await withServer({ manager: managerStub({ acquire }), maxBodyBytes: 128 }, async (baseUrl) => {
      const response = await postRaw(
        baseUrl,
        '/mcp-runtime/acquire',
        JSON.stringify({ padding: 'x'.repeat(256) }),
        INTERNAL_TOKEN,
      );

      expect(response.status).toBe(413);
      expect(acquire).not.toHaveBeenCalled();
    });
  });

  test('times out and cancels one request without aborting a concurrent request', async () => {
    const firstStarted = deferred();
    const secondStarted = deferred();
    const firstAborted = deferred();
    let secondSignal: AbortSignal | undefined;
    let resolveSecond: ((value: unknown) => void) | undefined;
    const invoke = mock(
      async (
        _fence: McpRuntimeFence,
        _holderId: string,
        _name: string,
        args: Record<string, unknown>,
        context: { signal: AbortSignal },
      ) =>
        new Promise<unknown>((resolve, reject) => {
          const id = args.id;
          if (id === 'first') {
            firstStarted.resolve();
            context.signal.addEventListener(
              'abort',
              () => {
                firstAborted.resolve();
                reject(context.signal.reason);
              },
              { once: true },
            );
            return;
          }
          secondSignal = context.signal;
          resolveSecond = resolve;
          secondStarted.resolve();
          context.signal.addEventListener('abort', () => reject(context.signal.reason), {
            once: true,
          });
        }),
    );

    await withServer(
      {
        manager: managerStub({ invoke }),
        requestTimeoutMs: 100,
        operationTimeoutOverheadMs: 25,
      },
      async (baseUrl) => {
        const firstResponse = post(
          baseUrl,
          '/mcp-runtime/invoke',
          invokeBody({ id: 'first' }, { idleTimeoutMs: 50, maxTotalTimeoutMs: 75 }),
          INTERNAL_TOKEN,
        );
        await firstStarted.promise;
        await delay(50);
        const secondResponse = post(
          baseUrl,
          '/mcp-runtime/invoke',
          invokeBody({ id: 'second' }, { idleTimeoutMs: 50, maxTotalTimeoutMs: 75 }),
          INTERNAL_TOKEN,
        );
        await secondStarted.promise;
        await firstAborted.promise;

        expect(secondSignal?.aborted).toBe(false);
        resolveSecond?.({ content: [{ type: 'text', text: 'second completed' }] });

        const [first, second] = await Promise.all([firstResponse, secondResponse]);
        expect(first.status).toBe(500);
        expect(second.status).toBe(200);
        expect(await second.json()).toEqual({
          content: [{ type: 'text', text: 'second completed' }],
        });
      },
    );
  });

  test('allows a routed operation to use its own total budget beyond the default request timeout', async () => {
    const invoke = mock(
      async (
        _fence: McpRuntimeFence,
        _holderId: string,
        _name: string,
        _args: Record<string, unknown>,
        context: { signal: AbortSignal },
      ) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => resolve({ content: [{ type: 'text', text: 'completed' }] }),
            60,
          );
          context.signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              reject(context.signal.reason);
            },
            { once: true },
          );
        }),
    );

    await withServer(
      {
        manager: managerStub({ invoke }),
        requestTimeoutMs: 20,
        operationTimeoutOverheadMs: 25,
      },
      async (baseUrl) => {
        const response = await post(
          baseUrl,
          '/mcp-runtime/invoke',
          invokeBody({}, { idleTimeoutMs: 50, maxTotalTimeoutMs: 100 }),
          INTERNAL_TOKEN,
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          content: [{ type: 'text', text: 'completed' }],
        });
      },
    );
  });
});

interface ServerFixtureOptions {
  manager: McpRuntimeManager;
  maxBodyBytes?: number;
  requestTimeoutMs?: number;
  operationTimeoutOverheadMs?: number;
  logger?: McpRuntimeInternalServerLogger;
}

async function withServer(
  options: ServerFixtureOptions,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = await startMcpRuntimeInternalServer({
    ...options,
    token: INTERNAL_TOKEN,
    host: '127.0.0.1',
    port: 0,
    logger: options.logger ?? collectingLogger([]),
  });
  try {
    await run(`http://${server.host}:${server.port}`);
  } finally {
    await server.close();
  }
}

function post(baseUrl: string, path: string, body: unknown, token?: string): Promise<Response> {
  return postRaw(baseUrl, path, JSON.stringify(body), token);
}

function postRaw(baseUrl: string, path: string, body: string, token?: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { [MCP_RUNTIME_INTERNAL_AUTH_HEADER]: token } : {}),
    },
    body,
  });
}

function managerStub(overrides: Record<string, unknown> = {}): McpRuntimeManager {
  return {
    processIdentity,
    acquire: async () => readyRef(),
    retain: () => undefined,
    discover: async () => ({
      protocolEra: 'modern',
      protocolVersion: '2026-07-28',
      capabilityFingerprint: HASH_A,
      tools: [],
      resources: [],
      resourceTemplates: [],
      prompts: [],
    }),
    invoke: async () => ({}),
    read: async () => ({}),
    getPrompt: async () => ({}),
    touch: () => readyRef(),
    renew: async () => readyRef(),
    release: async () => undefined,
    health: async () => ({
      fence,
      state: 'ready',
      status: 'healthy',
      checkedAt: new Date().toISOString(),
      leaseExpiresAt: new Date().toISOString(),
    }),
    ...overrides,
  } as unknown as McpRuntimeManager;
}

function readyRef(): McpRuntimeRef {
  return {
    fence,
    state: 'ready',
    leaseExpiresAt: '2026-08-01T08:01:00.000Z',
    protocolEra: 'modern',
    protocolVersion: '2026-07-28',
    ownerAddress: processIdentity.ownerAddress,
    capabilityFingerprint: HASH_A,
  };
}

function invokeBody(
  args: Record<string, unknown>,
  context = { idleTimeoutMs: 1_000, maxTotalTimeoutMs: 5_000 },
): Record<string, unknown> {
  return {
    fence,
    holderId: HOLDER_ID,
    name: 'search',
    args,
    context,
  };
}

function collectingLogger(entries: Record<string, unknown>[]): McpRuntimeInternalServerLogger {
  return {
    info(entry) {
      entries.push(entry);
    },
    error(entry) {
      entries.push(entry);
    },
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
