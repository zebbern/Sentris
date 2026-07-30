import { createServer, request as httpRequest } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'bun:test';
import { runComponentWithRunner } from '@sentris/component-sdk';

const closeHandles: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closeHandles.splice(0).map((close) => close()));
});

async function startTargetServer(): Promise<{
  origin: string;
  requests: { url: string; authorization?: string }[];
}> {
  const requests: { url: string; authorization?: string }[] = [];
  const server = createServer((request, response) => {
    requests.push({
      url: request.url ?? '',
      authorization: request.headers.authorization,
    });
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok', servers: [{ ready: true }] }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('target did not bind');
  closeHandles.push(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  return { origin: `http://127.0.0.1:${address.port}`, requests };
}

describe('worker-owned Docker MCP proxy', () => {
  it('publishes stable app-network endpoints while authenticating and forwarding to DIND', async () => {
    const dockerProxy = await import('../mcp-docker-proxy').catch(() => undefined);
    const target = await startTargetServer();
    const proxy = await dockerProxy?.startMcpDockerProxy({
      port: 0,
      publicBaseUrl: 'http://worker:9101',
      authToken: 'proxy-token',
    });
    if (!proxy) throw new Error('proxy did not start');
    closeHandles.push(() => proxy.close());
    const registration = proxy.registerTarget({
      containerId: 'mcp-container-1',
      runId: 'sentris-run-1',
      targetOrigin: target.origin,
    });

    expect(registration).toEqual({
      endpoint: 'http://worker:9101/containers/mcp-container-1/mcp',
      authToken: 'proxy-token',
    });
    const localUrl = `http://127.0.0.1:${proxy.port}/containers/mcp-container-1/health`;
    expect((await fetch(localUrl)).status).toBe(401);
    expect(
      (
        await fetch(localUrl, {
          headers: { 'x-sentris-mcp-proxy-token': 'wrong-token' },
        })
      ).status,
    ).toBe(401);

    const response = await fetch(localUrl, {
      headers: {
        'x-sentris-mcp-proxy-token': 'proxy-token',
        Authorization: 'Bearer target-token',
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ok',
      servers: [{ ready: true }],
    });
    expect(target.requests).toEqual([{ url: '/health', authorization: 'Bearer target-token' }]);
  });

  it('removes every target for a completed run without affecting another run', async () => {
    const dockerProxy = await import('../mcp-docker-proxy').catch(() => undefined);
    const target = await startTargetServer();
    const proxy = await dockerProxy?.startMcpDockerProxy({
      port: 0,
      publicBaseUrl: 'http://worker:9101',
      authToken: 'proxy-token',
    });
    if (!proxy) throw new Error('proxy did not start');
    closeHandles.push(() => proxy.close());
    proxy.registerTarget({
      containerId: 'run-a-container',
      runId: 'run-a',
      targetOrigin: target.origin,
    });
    proxy.registerTarget({
      containerId: 'run-b-container',
      runId: 'run-b',
      targetOrigin: target.origin,
    });

    expect(proxy.removeRunTargets('run-a')).toBe(1);

    const headers = { 'x-sentris-mcp-proxy-token': 'proxy-token' };
    expect(
      (await fetch(`http://127.0.0.1:${proxy.port}/containers/run-a-container/health`, { headers }))
        .status,
    ).toBe(404);
    expect(
      (await fetch(`http://127.0.0.1:${proxy.port}/containers/run-b-container/health`, { headers }))
        .status,
    ).toBe(200);
  });

  it('rejects a scheme-relative suffix without escaping the registered target origin', async () => {
    const dockerProxy = await import('../mcp-docker-proxy');
    const registeredTarget = await startTargetServer();
    const escapedTarget = await startTargetServer();
    const escapedPort = new URL(escapedTarget.origin).port;
    const proxy = await dockerProxy.startMcpDockerProxy({
      port: 0,
      publicBaseUrl: 'http://worker:9101',
      authToken: 'proxy-token',
    });
    closeHandles.push(() => proxy.close());
    proxy.registerTarget({
      containerId: 'registered-container',
      runId: 'registered-run',
      targetOrigin: registeredTarget.origin,
    });

    const response = await fetch(
      `http://127.0.0.1:${proxy.port}/containers/registered-container//127.0.0.1:${escapedPort}/escaped`,
      {
        headers: { 'x-sentris-mcp-proxy-token': 'proxy-token' },
      },
    );

    expect(response.status).toBe(400);
    expect(registeredTarget.requests).toEqual([]);
    expect(escapedTarget.requests).toEqual([]);
  });

  it('continues to forward ordinary MCP request bodies below the limit', async () => {
    let receivedBody = '';
    const targetServer = createServer((request, response) => {
      void (async () => {
        for await (const chunk of request) {
          receivedBody += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
        }
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ accepted: true }));
      })();
    });
    await new Promise<void>((resolve, reject) => {
      targetServer.once('error', reject);
      targetServer.listen(0, '127.0.0.1', resolve);
    });
    const targetAddress = targetServer.address();
    if (!targetAddress || typeof targetAddress === 'string') throw new Error('target did not bind');
    closeHandles.push(
      () =>
        new Promise<void>((resolve, reject) =>
          targetServer.close((error) => (error ? reject(error) : resolve())),
        ),
    );

    const dockerProxy = await import('../mcp-docker-proxy');
    const proxy = await dockerProxy.startMcpDockerProxy({
      port: 0,
      publicBaseUrl: 'http://worker:9101',
      authToken: 'proxy-token',
    });
    closeHandles.push(() => proxy.close());
    proxy.registerTarget({
      containerId: 'body-container',
      runId: 'body-run',
      targetOrigin: `http://127.0.0.1:${targetAddress.port}`,
    });
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'scan', arguments: { target: 'https://example.com' } },
    });

    const response = await fetch(`http://127.0.0.1:${proxy.port}/containers/body-container/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-sentris-mcp-proxy-token': 'proxy-token',
      },
      body: payload,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: true });
    expect(receivedBody).toBe(payload);
  });

  it('rejects request bodies larger than the existing 2 MiB MCP proxy boundary', async () => {
    const dockerProxy = await import('../mcp-docker-proxy');
    const target = await startTargetServer();
    const proxy = await dockerProxy.startMcpDockerProxy({
      port: 0,
      publicBaseUrl: 'http://worker:9101',
      authToken: 'proxy-token',
    });
    closeHandles.push(() => proxy.close());
    proxy.registerTarget({
      containerId: 'bounded-container',
      runId: 'bounded-run',
      targetOrigin: target.origin,
    });

    const response = await fetch(
      `http://127.0.0.1:${proxy.port}/containers/bounded-container/mcp`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-sentris-mcp-proxy-token': 'proxy-token',
        },
        body: Buffer.alloc(2 * 1024 * 1024 + 1, 0x61),
      },
    );

    expect(response.status).toBe(413);
    expect(target.requests).toEqual([]);
  });

  it('enforces the request body boundary for chunked transfers without Content-Length', async () => {
    const dockerProxy = await import('../mcp-docker-proxy');
    const target = await startTargetServer();
    const proxy = await dockerProxy.startMcpDockerProxy({
      port: 0,
      publicBaseUrl: 'http://worker:9101',
      authToken: 'proxy-token',
    });
    closeHandles.push(() => proxy.close());
    proxy.registerTarget({
      containerId: 'chunked-container',
      runId: 'chunked-run',
      targetOrigin: target.origin,
    });

    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(
        `http://127.0.0.1:${proxy.port}/containers/chunked-container/mcp`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-sentris-mcp-proxy-token': 'proxy-token',
          },
        },
        (response) => {
          response.resume();
          response.once('end', () => resolve(response.statusCode ?? 0));
        },
      );
      request.once('error', reject);
      request.write(Buffer.alloc(1024 * 1024, 0x61));
      request.write(Buffer.alloc(1024 * 1024 + 1, 0x62));
      request.end();
    });

    expect(status).toBe(413);
    expect(target.requests).toEqual([]);
  });

  it('cancels the DIND request when the downstream MCP client disconnects', async () => {
    let upstreamClosed = false;
    const targetServer = createServer((request, response) => {
      request.once('close', () => {
        upstreamClosed = true;
      });
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write('data: connected\n\n');
    });
    await new Promise<void>((resolve, reject) => {
      targetServer.once('error', reject);
      targetServer.listen(0, '127.0.0.1', resolve);
    });
    const address = targetServer.address();
    if (!address || typeof address === 'string') throw new Error('target did not bind');
    closeHandles.push(
      () =>
        new Promise<void>((resolve, reject) =>
          targetServer.close((error) => (error ? reject(error) : resolve())),
        ),
    );

    const dockerProxy = await import('../mcp-docker-proxy');
    const proxy = await dockerProxy.startMcpDockerProxy({
      port: 0,
      publicBaseUrl: 'http://worker:9101',
      authToken: 'proxy-token',
    });
    closeHandles.push(() => proxy.close());
    proxy.registerTarget({
      containerId: 'streaming-container',
      runId: 'streaming-run',
      targetOrigin: `http://127.0.0.1:${address.port}`,
    });

    const controller = new AbortController();
    const response = await fetch(
      `http://127.0.0.1:${proxy.port}/containers/streaming-container/mcp`,
      {
        headers: { 'x-sentris-mcp-proxy-token': 'proxy-token' },
        signal: controller.signal,
      },
    );
    await response.body?.getReader().read();
    controller.abort();

    for (let attempt = 0; attempt < 20 && !upstreamClosed; attempt += 1) {
      await Bun.sleep(10);
    }
    expect(upstreamClosed).toBe(true);
  });
});

describe('Docker MCP runtime reachability', () => {
  it('uses a Docker-assigned DIND port and registers it behind the worker proxy', async () => {
    const runtime = await import('../mcp-runtime').catch(() => undefined);
    const runComponent = vi.fn(async () => ({
      containerId: 'full-container-sha',
      status: 'running',
    }));
    const dockerCommand = vi.fn(async () => ({
      stdout: '0.0.0.0:49153\n[::]:49153\n',
      stderr: '',
    }));
    const registerTarget = vi.fn(() => ({
      endpoint: 'http://worker:9101/containers/mcp-runtime-container/mcp',
      authToken: 'proxy-token',
    }));

    const result = await runtime?.startMcpDockerServer(
      {
        image: 'example/mcp:latest',
        command: [],
        port: 8080,
        params: {},
        context: { runId: 'sentris-run-1' },
      },
      {
        runComponent: runComponent as unknown as typeof runComponentWithRunner,
        dockerCommand,
        proxy: { registerTarget },
        env: { SENTRIS_DIND_HOST: 'dind' },
        now: () => 1234,
      },
    );

    expect(runComponent).toHaveBeenCalledWith(
      expect.objectContaining({
        ports: { auto: 8080 },
        containerName: 'mcp-server-example-mcp-latest-1234',
      }),
      expect.any(Function),
      {},
      expect.anything(),
    );
    expect(dockerCommand).toHaveBeenCalledWith([
      'port',
      'mcp-server-example-mcp-latest-1234',
      '8080/tcp',
    ]);
    expect(registerTarget).toHaveBeenCalledWith({
      containerId: 'mcp-server-example-mcp-latest-1234',
      runId: 'sentris-run-1',
      targetOrigin: 'http://dind:49153',
    });
    expect(result).toEqual({
      endpoint: 'http://worker:9101/containers/mcp-runtime-container/mcp',
      authToken: 'proxy-token',
      containerId: 'mcp-server-example-mcp-latest-1234',
    });
  });
});
