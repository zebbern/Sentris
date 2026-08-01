import { describe, expect, mock, test } from 'bun:test';
import type {
  McpRuntimeAcquireRequest,
  McpRuntimeAcquisition,
  McpRuntimeFence,
  McpRuntimeKey,
  McpReadyRuntimeRef,
} from '@sentris/shared';

import {
  McpRuntimeInternalClient,
  McpRuntimeInternalHttpError,
} from '../mcp-runtime-internal.client';
import { McpRuntimeFenceLostError, type McpRuntimeManager } from '../mcp-runtime-manager';
import { McpRuntimeRouter } from '../mcp-runtime-router';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const RUNTIME_ID = '10000000-0000-4000-8000-000000000001';
const OWNER_EPOCH = '20000000-0000-4000-8000-000000000002';
const REMOTE_OWNER_EPOCH = '30000000-0000-4000-8000-000000000003';
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
const localFence: McpRuntimeFence = {
  runtimeId: RUNTIME_ID,
  ownerId: processIdentity.ownerId,
  ownerEpoch: processIdentity.ownerEpoch,
  leaseGeneration: 4,
};

describe('McpRuntimeRouter', () => {
  test('acquires locally with the unfenced runtime key and this process candidate', async () => {
    const acquire = mock(async () => readyRef(localFence, processIdentity.ownerAddress));
    const retain = mock(() => undefined);
    const post = mock(async () => {
      throw new Error('HTTP must not be used for acquire');
    });
    const router = new McpRuntimeRouter(managerStub({ acquire, retain }), {
      post,
    } as unknown as McpRuntimeInternalClient);

    const signal = new AbortController().signal;
    const acquisition = await router.acquire(runtimeKey, HOLDER_ID, signal);

    expect(acquisition).toEqual({
      ref: readyRef(localFence, processIdentity.ownerAddress),
      holderId: HOLDER_ID,
    });

    expect(acquire).toHaveBeenCalledTimes(1);
    expect(acquire).toHaveBeenCalledWith(runtimeKey, processIdentity, signal);
    expect(retain).toHaveBeenCalledWith(localFence, acquisition.holderId);
    expect(post).not.toHaveBeenCalled();
  });

  test('retains a remote owner before returning its holder acquisition', async () => {
    const remoteFence: McpRuntimeFence = {
      ...localFence,
      ownerId: 'worker-7',
      ownerEpoch: REMOTE_OWNER_EPOCH,
    };
    const remoteAddress = 'http://worker-7.internal:10001';
    const acquire = mock(async () => readyRef(remoteFence, remoteAddress));
    const post = mock(async () => ({ retained: true }));
    const router = new McpRuntimeRouter(managerStub({ acquire }), {
      post,
    } as unknown as McpRuntimeInternalClient);
    const signal = new AbortController().signal;

    const held = await router.acquire(runtimeKey, HOLDER_ID, signal);

    expect(held.ref).toEqual(readyRef(remoteFence, remoteAddress));
    expect(post).toHaveBeenCalledWith(
      remoteAddress,
      '/mcp-runtime/retain',
      { fence: remoteFence, holderId: held.holderId },
      signal,
    );
  });

  test('best-effort releases the same holder when a remote retain response is ambiguous', async () => {
    const remoteFence: McpRuntimeFence = {
      ...localFence,
      ownerId: 'worker-7',
      ownerEpoch: REMOTE_OWNER_EPOCH,
    };
    const remoteAddress = 'http://worker-7.internal:10001';
    const post = mock(
      async (
        _address: string,
        path: string,
        _body: unknown,
        _signal: AbortSignal,
        _timeoutMs?: number,
      ) => (path === '/mcp-runtime/retain' ? { retained: false } : { released: true }),
    );
    const router = new McpRuntimeRouter(
      managerStub({ acquire: async () => readyRef(remoteFence, remoteAddress) }),
      { post } as unknown as McpRuntimeInternalClient,
    );

    await expect(
      router.acquire(runtimeKey, HOLDER_ID, new AbortController().signal),
    ).rejects.toThrow('invalid retain response');

    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[1]?.slice(0, 3)).toEqual([
      remoteAddress,
      '/mcp-runtime/release',
      { fence: remoteFence, holderId: HOLDER_ID },
    ]);
    expect(post.mock.calls[1]?.[3]).toBeInstanceOf(AbortSignal);
  });

  test('dispatches a local owner directly without any HTTP hop', async () => {
    const signal = new AbortController().signal;
    const invokeResult = { content: [{ type: 'text', text: 'local' }] };
    const invoke = mock(async () => invokeResult);
    const post = mock(async () => {
      throw new Error('HTTP must not be used for a local owner');
    });
    const router = new McpRuntimeRouter(managerStub({ invoke }), {
      post,
    } as unknown as McpRuntimeInternalClient);

    await expect(
      router.execute(
        acquisition(readyRef(localFence, processIdentity.ownerAddress)),
        {
          kind: 'invoke',
          name: 'search',
          args: { query: 'sentris' },
          context: { idleTimeoutMs: 1_000, maxTotalTimeoutMs: 5_000 },
        },
        signal,
      ),
    ).resolves.toEqual(invokeResult);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith(
      localFence,
      HOLDER_ID,
      'search',
      { query: 'sentris' },
      { signal, idleTimeoutMs: 1_000, maxTotalTimeoutMs: 5_000 },
    );
    expect(post).not.toHaveBeenCalled();
  });

  test('uses exactly one direct request to the persisted remote owner address', async () => {
    const remoteFence: McpRuntimeFence = {
      ...localFence,
      ownerId: 'worker-7',
      ownerEpoch: REMOTE_OWNER_EPOCH,
      leaseGeneration: 9,
    };
    const remoteAddress = 'http://worker-7.internal:10001';
    const signal = new AbortController().signal;
    const health = {
      fence: remoteFence,
      state: 'ready' as const,
      status: 'healthy' as const,
      checkedAt: '2026-08-01T08:00:00.000Z',
      leaseExpiresAt: '2026-08-01T08:01:00.000Z',
    };
    const post = mock(async () => health);
    const router = new McpRuntimeRouter(managerStub(), {
      post,
    } as unknown as McpRuntimeInternalClient);

    await expect(
      router.execute(acquisition(readyRef(remoteFence, remoteAddress)), { kind: 'health' }, signal),
    ).resolves.toEqual(health);

    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(
      remoteAddress,
      '/mcp-runtime/health',
      { fence: remoteFence, holderId: HOLDER_ID },
      signal,
    );
  });

  test('touches a remote holder without renewing the shared lease', async () => {
    const remoteFence: McpRuntimeFence = {
      ...localFence,
      ownerId: 'worker-7',
      ownerEpoch: REMOTE_OWNER_EPOCH,
    };
    const remoteAddress = 'http://worker-7.internal:10001';
    const signal = new AbortController().signal;
    const touchedRef = readyRef(remoteFence, remoteAddress);
    const post = mock(async () => touchedRef);
    const router = new McpRuntimeRouter(managerStub(), {
      post,
    } as unknown as McpRuntimeInternalClient);

    await expect(
      router.execute(acquisition(touchedRef), { kind: 'touch' }, signal),
    ).resolves.toEqual(touchedRef);
    expect(post).toHaveBeenCalledWith(
      remoteAddress,
      '/mcp-runtime/touch',
      { fence: remoteFence, holderId: HOLDER_ID },
      signal,
    );
  });

  test('derives a remote operation deadline from its total budget plus bounded overhead', async () => {
    const remoteFence: McpRuntimeFence = {
      ...localFence,
      ownerId: 'worker-8',
      ownerEpoch: REMOTE_OWNER_EPOCH,
    };
    const remoteAddress = 'http://worker-8.internal:9301';
    const signal = new AbortController().signal;
    const post = mock(async () => ({ content: [] }));
    const router = new McpRuntimeRouter(managerStub(), {
      post,
    } as unknown as McpRuntimeInternalClient);

    await router.execute(
      acquisition(readyRef(remoteFence, remoteAddress)),
      {
        kind: 'invoke',
        name: 'search',
        args: {},
        context: { idleTimeoutMs: 1_000, maxTotalTimeoutMs: 5_000 },
      },
      signal,
    );

    expect(post).toHaveBeenCalledWith(
      remoteAddress,
      '/mcp-runtime/invoke',
      {
        fence: remoteFence,
        holderId: HOLDER_ID,
        name: 'search',
        args: {},
        context: { idleTimeoutMs: 1_000, maxTotalTimeoutMs: 5_000 },
      },
      signal,
      10_000,
    );
  });

  test('turns a remote owner 409 into the typed fence-loss failure', async () => {
    const remoteFence: McpRuntimeFence = {
      ...localFence,
      ownerId: 'worker-2',
      ownerEpoch: REMOTE_OWNER_EPOCH,
    };
    const post = mock(async () => {
      throw new McpRuntimeInternalHttpError(409, 'MCP runtime fence is stale');
    });
    const router = new McpRuntimeRouter(managerStub(), {
      post,
    } as unknown as McpRuntimeInternalClient);

    const result = await settled(
      router.execute(
        acquisition(readyRef(remoteFence, 'http://worker-2.internal:9301')),
        { kind: 'discover' },
        new AbortController().signal,
      ),
    );

    expect(result.status).toBe('rejected');
    expect(result.reason).toBeInstanceOf(McpRuntimeFenceLostError);
    expect((result.reason as Error).cause).toBeInstanceOf(McpRuntimeInternalHttpError);
  });
});

describe('McpRuntimeInternalClient boundaries', () => {
  test('rejects generic and public owner addresses before dispatch', async () => {
    const fetchFn = mock(async () => new Response('{}'));
    const client = new McpRuntimeInternalClient({ token: INTERNAL_TOKEN, fetchFn });
    const signal = new AbortController().signal;

    const [generic, publicAddress] = await Promise.all([
      settled(client.post('http://worker:9301', '/mcp-runtime/health', {}, signal)),
      settled(client.post('https://example.com:9301', '/mcp-runtime/health', {}, signal)),
    ]);

    expect(generic.status).toBe('rejected');
    expect((generic.reason as Error).message).toContain('one worker instance');
    expect(publicAddress.status).toBe('rejected');
    expect((publicAddress.reason as Error).message).toContain('private worker address');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  test('rejects an oversized owner response without buffering it as JSON', async () => {
    const fetchFn = mock(
      async () =>
        new Response('0123456789', {
          status: 200,
          headers: { 'content-length': '10' },
        }),
    );
    const client = new McpRuntimeInternalClient({
      token: INTERNAL_TOKEN,
      fetchFn,
      maxResponseBytes: 8,
    });

    const result = await settled(
      client.post(
        'http://worker-1.internal:9301',
        '/mcp-runtime/health',
        {},
        new AbortController().signal,
      ),
    );

    expect(result.status).toBe('rejected');
    expect((result.reason as Error).message).toContain('response exceeded');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

function managerStub(overrides: Record<string, unknown> = {}): McpRuntimeManager {
  return {
    processIdentity,
    acquire: async () => readyRef(localFence, processIdentity.ownerAddress),
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
    touch: () => readyRef(localFence, processIdentity.ownerAddress),
    renew: async () => readyRef(localFence, processIdentity.ownerAddress),
    release: async () => undefined,
    health: async () => ({
      fence: localFence,
      state: 'ready',
      status: 'healthy',
      checkedAt: new Date().toISOString(),
      leaseExpiresAt: new Date().toISOString(),
    }),
    ...overrides,
  } as unknown as McpRuntimeManager;
}

function acquisition(ref: McpReadyRuntimeRef): McpRuntimeAcquisition {
  return { ref, holderId: HOLDER_ID };
}

function readyRef(fence: McpRuntimeFence, ownerAddress: string): McpReadyRuntimeRef {
  return {
    fence,
    state: 'ready',
    leaseExpiresAt: '2026-08-01T08:01:00.000Z',
    protocolEra: 'modern',
    protocolVersion: '2026-07-28',
    ownerAddress,
    capabilityFingerprint: HASH_A,
  };
}

async function settled<T>(promise: Promise<T>) {
  try {
    return { status: 'fulfilled' as const, value: await promise, reason: undefined };
  } catch (reason: unknown) {
    return { status: 'rejected' as const, value: undefined, reason };
  }
}
