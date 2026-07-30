import { afterEach, describe, expect, it, jest } from 'bun:test';
import type { ConfigService } from '@nestjs/config';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  OpenSearchTenantService,
  delayWithAbort,
  fetchWithAttemptTimeout,
} from '../opensearch-tenant.service';

function config(values: Record<string, string>): ConfigService {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

interface RecordedRequest {
  url: string;
  options: RequestInit;
}

function installOpenSearchFetchMock(
  requests: RecordedRequest[],
  options: { mutateInstalledPipeline?: boolean; mutateInstalledMapping?: boolean } = {},
): void {
  const pipelines = new Map<string, Record<string, unknown>>();
  const templates = new Map<string, Record<string, unknown>>();
  const indices = new Map<
    string,
    {
      settings: Record<string, unknown>;
      mappings: Record<string, unknown>;
    }
  >();

  jest.spyOn(globalThis, 'fetch').mockImplementation((async (
    input: string | URL | Request,
    requestOptions: RequestInit = {},
  ) => {
    const url = String(input);
    const parsedUrl = new URL(url);
    const method = requestOptions.method ?? 'GET';
    requests.push({ url, options: requestOptions });

    const pipelinePrefix = '/_ingest/pipeline/';
    if (parsedUrl.pathname.startsWith(pipelinePrefix)) {
      const id = decodeURIComponent(parsedUrl.pathname.slice(pipelinePrefix.length));
      if (method === 'PUT') {
        pipelines.set(id, JSON.parse(String(requestOptions.body)) as Record<string, unknown>);
        return new Response('{}', { status: 200 });
      }
      const installed = pipelines.get(id);
      const body =
        installed && options.mutateInstalledPipeline
          ? { ...installed, version: Number(installed.version ?? 0) + 1 }
          : installed
            ? { ...installed, deprecated: false }
            : installed;
      return new Response(JSON.stringify(body ? { [id]: body } : {}), { status: 200 });
    }

    const templatePrefix = '/_index_template/';
    if (parsedUrl.pathname.startsWith(templatePrefix)) {
      const name = decodeURIComponent(parsedUrl.pathname.slice(templatePrefix.length));
      if (method === 'PUT') {
        templates.set(name, JSON.parse(String(requestOptions.body)) as Record<string, unknown>);
        return new Response('{}', { status: 200 });
      }
      const installed = templates.get(name);
      const template = installed ? asOpenSearchTemplateGet(installed) : undefined;
      return new Response(
        JSON.stringify({
          index_templates: template ? [{ name, index_template: template }] : [],
        }),
        { status: 200 },
      );
    }

    const indexMatch = parsedUrl.pathname.match(
      /^\/(security-findings-o[a-f0-9]{64}-observations-v1)(?:\/_(settings|mapping))?$/,
    );
    if (indexMatch) {
      const [, indexName, readKind] = indexMatch;
      if (method === 'PUT' && !readKind) {
        const body = JSON.parse(String(requestOptions.body)) as {
          settings: Record<string, unknown>;
          mappings: Record<string, unknown>;
        };
        indices.set(indexName, body);
        return new Response('{}', { status: 200 });
      }
      const installed = indices.get(indexName);
      if (readKind === 'settings') {
        return new Response(
          JSON.stringify({
            [indexName]: {
              settings: {
                index: {
                  final_pipeline: installed?.settings['index.final_pipeline'],
                },
              },
            },
          }),
          { status: 200 },
        );
      }
      if (readKind === 'mapping') {
        const mappings = installed?.mappings
          ? asOpenSearchMappingGet(installed.mappings)
          : installed?.mappings;
        if (options.mutateInstalledMapping && mappings) {
          const properties = (mappings as Record<string, unknown>).properties as Record<
            string,
            Record<string, unknown>
          >;
          properties.title = { type: 'keyword' };
        }
        return new Response(
          JSON.stringify({
            [indexName]: {
              mappings,
            },
          }),
          { status: 200 },
        );
      }
    }

    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch);
}

function asOpenSearchMappingGet(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => asOpenSearchMappingGet(item));
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      (key === 'dynamic' || key === 'enabled') && typeof child === 'boolean'
        ? String(child)
        : asOpenSearchMappingGet(child),
    ]),
  );
}

function asOpenSearchTemplateGet(template: Record<string, unknown>): Record<string, unknown> {
  const templateBody = template.template as {
    settings: Record<string, unknown>;
    mappings: Record<string, unknown>;
  };
  return {
    ...template,
    composed_of: [],
    version: String(template.version),
    priority: String(template.priority),
    template: {
      ...templateBody,
      settings: {
        index: {
          number_of_shards: String(templateBody.settings.number_of_shards),
          number_of_replicas: String(templateBody.settings.number_of_replicas),
          final_pipeline: templateBody.settings['index.final_pipeline'],
        },
      },
      mappings: asOpenSearchMappingGet(templateBody.mappings),
    },
  };
}

describe('OpenSearchTenantService organization identity', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('bounds a never-resolving tenant fetch attempt and makes retry delay abortable', async () => {
    const neverResolvingFetch = ((_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
          once: true,
        });
      })) as typeof fetch;

    await expect(
      fetchWithAttemptTimeout(neverResolvingFetch, 'http://opensearch:9200/_cluster/health', {}, 5),
    ).rejects.toBeInstanceOf(Error);

    const controller = new AbortController();
    const delay = delayWithAbort(60_000, controller.signal);
    controller.abort(new Error('request cancelled'));
    await expect(delay).rejects.toThrow('request cancelled');
  });

  it('settles the real Bun fetch when a loopback peer never returns response headers', async () => {
    const server = createServer(() => {
      // Deliberately retain the accepted request without writing headers.
    });
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once('error', rejectListen);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', rejectListen);
        resolveListen();
      });
    });
    const { port } = server.address() as AddressInfo;

    try {
      await expect(
        fetchWithAttemptTimeout(fetch, `http://127.0.0.1:${port}/never-headers`, {}, 50),
      ).rejects.toBeInstanceOf(Error);
    } finally {
      server.closeAllConnections();
      if (server.listening) {
        await new Promise<void>((resolveClose, rejectClose) => {
          server.close((error) => {
            if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
              rejectClose(error);
            } else resolveClose();
          });
        });
      }
    }
  });

  it('does not resolve a status-only real Bun request at headers while its body is stalled', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.write('{"partial":');
    });
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once('error', rejectListen);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', rejectListen);
        resolveListen();
      });
    });
    const { port } = server.address() as AddressInfo;

    try {
      await expect(
        fetchWithAttemptTimeout(fetch, `http://127.0.0.1:${port}/never-body`, {}, 50),
      ).rejects.toBeInstanceOf(Error);
    } finally {
      server.closeAllConnections();
      if (server.listening) {
        await new Promise<void>((resolveClose, rejectClose) => {
          server.close((error) => {
            if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
              rejectClose(error);
            } else resolveClose();
          });
        });
      }
    }
  });

  it('clears a successful fetch attempt timer without a late abort', async () => {
    let attemptSignal: AbortSignal | null = null;
    const immediateFetch = ((_input: string | URL | Request, init?: RequestInit) => {
      attemptSignal = init?.signal as AbortSignal;
      return Promise.resolve(new Response('{}', { status: 200 }));
    }) as typeof fetch;

    await fetchWithAttemptTimeout(immediateFetch, 'http://opensearch:9200/_cluster/health', {}, 5);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect((attemptSignal as AbortSignal | null)?.aborted).toBe(false);
  });

  it('propagates the provisioning abort signal and starts no later mutation', async () => {
    const controller = new AbortController();
    let fetchCalls = 0;
    jest.spyOn(globalThis, 'fetch').mockImplementation((async (
      _input: string | URL | Request,
      options: RequestInit = {},
    ) => {
      fetchCalls += 1;
      expect(options.signal).toBeInstanceOf(AbortSignal);
      controller.abort(new Error('tenant request aborted'));
      return new Response('{}', { status: 200 });
    }) as typeof fetch);
    const service = new OpenSearchTenantService(
      config({
        OPENSEARCH_SECURITY_ENABLED: 'false',
        OPENSEARCH_URL: 'http://opensearch:9200',
      }),
    );

    await expect(service.ensureTenantExists('org-1', controller.signal)).rejects.toThrow(
      'tenant request aborted',
    );
    expect(fetchCalls).toBe(1);
  });

  it('provisions case-distinct organizations into disjoint safe resources', async () => {
    const requests: RecordedRequest[] = [];
    installOpenSearchFetchMock(requests);
    const service = new OpenSearchTenantService(
      config({
        OPENSEARCH_SECURITY_ENABLED: 'true',
        OPENSEARCH_URL: 'http://opensearch:9200',
        OPENSEARCH_DASHBOARDS_URL: 'http://dashboards:5601',
        OPENSEARCH_ADMIN_USERNAME: 'admin',
        OPENSEARCH_ADMIN_PASSWORD: 'password',
      }),
    );

    await expect(service.ensureTenantExists('Org-A')).resolves.toBe(true);
    await expect(service.ensureTenantExists('org-a')).resolves.toBe(true);
    await expect(service.ensureTenantExists(' Org-A ')).resolves.toBe(true);

    const tenantUrls = requests
      .map(({ url }) => url)
      .filter((url) => url.includes('/_plugins/_security/api/tenants/'));
    expect(tenantUrls).toHaveLength(3);
    expect(new Set(tenantUrls).size).toBe(3);
    expect(tenantUrls[0]).toMatch(/\/o[a-f0-9]{64}$/);
    expect(tenantUrls[1]).toMatch(/\/o[a-f0-9]{64}$/);
    expect(tenantUrls[2]).toMatch(/\/o[a-f0-9]{64}$/);

    const templateRequests = requests.filter(
      ({ url, options }) => url.includes('/_index_template/') && options.method === 'PUT',
    );
    expect(templateRequests).toHaveLength(3);
    for (const request of templateRequests) {
      const body = JSON.parse(String(request.options.body)) as {
        index_patterns: string[];
        template: { settings: { 'index.final_pipeline': string } };
      };
      expect(body.index_patterns).toHaveLength(1);
      expect(body.index_patterns[0]).toMatch(/^security-findings-o[a-f0-9]{64}-observations-v1$/);
      expect(body.index_patterns[0]).not.toContain('*');
      expect(body.template.settings['index.final_pipeline']).toBeString();
    }
  });

  it('provisions exact observation storage artifacts when security is disabled', async () => {
    const requests: RecordedRequest[] = [];
    installOpenSearchFetchMock(requests);
    const service = new OpenSearchTenantService(
      config({
        OPENSEARCH_SECURITY_ENABLED: 'false',
        OPENSEARCH_URL: 'http://opensearch:9200',
        OPENSEARCH_DASHBOARDS_URL: 'http://dashboards:5601',
      }),
    );

    await expect(service.ensureTenantExists('Org-A')).resolves.toBe(true);

    const writeRequests = requests.filter(({ options }) => options.method === 'PUT');
    expect(writeRequests.map(({ url }) => url)).toEqual([
      expect.stringMatching(
        /^http:\/\/opensearch:9200\/_ingest\/pipeline\/sentris-findings-observation-final-[a-f0-9]{16}$/,
      ),
      expect.stringMatching(
        /^http:\/\/opensearch:9200\/_index_template\/sentris-findings-observation-o[a-f0-9]{64}-[a-f0-9]{12}-[a-f0-9]{12}$/,
      ),
      expect.stringMatching(
        /^http:\/\/opensearch:9200\/security-findings-o[a-f0-9]{64}-observations-v1$/,
      ),
    ]);
    expect(requests.some(({ url }) => url.includes('/_plugins/_security/'))).toBe(false);
    expect(requests.some(({ url }) => url.startsWith('http://dashboards:5601/'))).toBe(false);

    const pipeline = JSON.parse(String(writeRequests[0].options.body)) as {
      processors?: unknown[];
    };
    expect(pipeline.processors).toBeArray();
    const template = JSON.parse(String(writeRequests[1].options.body)) as {
      index_patterns: string[];
      template: {
        settings: { 'index.final_pipeline': string };
        mappings: { dynamic: boolean };
      };
    };
    expect(template.index_patterns).toEqual([
      expect.stringMatching(/^security-findings-o[a-f0-9]{64}-observations-v1$/),
    ]);
    expect(template.template.settings['index.final_pipeline']).toMatch(
      /^sentris-findings-observation-final-[a-f0-9]{16}$/,
    );
    expect(template.template.mappings.dynamic).toBe(false);
    const seedIndex = JSON.parse(String(writeRequests[2].options.body)) as {
      settings: { 'index.final_pipeline': string };
      mappings: { dynamic: boolean; properties: Record<string, unknown> };
    };
    expect(seedIndex.settings['index.final_pipeline']).toBe(
      template.template.settings['index.final_pipeline'],
    );
    expect(seedIndex.mappings.dynamic).toBe(false);
    expect(seedIndex.mappings.properties).toHaveProperty('sentris');
    expect(requests.filter(({ options }) => options.method === 'GET')).toHaveLength(4);
  });

  it('fails provisioning when installed observation invariants drift', async () => {
    const requests: RecordedRequest[] = [];
    installOpenSearchFetchMock(requests, { mutateInstalledPipeline: true });
    const service = new OpenSearchTenantService(
      config({
        OPENSEARCH_SECURITY_ENABLED: 'false',
        OPENSEARCH_URL: 'http://opensearch:9200',
      }),
    );

    await expect(service.ensureTenantExists('org-1')).resolves.toBe(false);
    expect(requests.some(({ options }) => options.method === 'GET')).toBe(true);
  });

  it('rejects material mapping drift after normalizing harmless GET serialization differences', async () => {
    const requests: RecordedRequest[] = [];
    installOpenSearchFetchMock(requests, { mutateInstalledMapping: true });
    const service = new OpenSearchTenantService(
      config({
        OPENSEARCH_SECURITY_ENABLED: 'false',
        OPENSEARCH_URL: 'http://opensearch:9200',
      }),
    );

    await expect(service.ensureTenantExists('org-1')).resolves.toBe(false);
  });
});
