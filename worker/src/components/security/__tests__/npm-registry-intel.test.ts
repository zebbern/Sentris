import { afterEach, describe, expect, it, vi } from 'bun:test';
import {
  componentRegistry,
  createExecutionContext,
  type ExecutionContext,
} from '@sentris/component-sdk';
import '../npm-registry-intel';
import type {
  NpmRegistryIntelInputSchema,
  NpmRegistryIntelOutput,
  NpmRegistryIntelOutputSchema,
} from '../npm-registry-intel';

const npmPackageResponse = {
  name: 'suspicious-pkg',
  description: 'Suspicious package fixture',
  'dist-tags': { latest: '1.0.0' },
  time: {
    created: '2026-01-01T00:00:00.000Z',
    modified: '2026-06-20T00:00:00.000Z',
    '1.0.0': '2026-06-20T00:00:00.000Z',
  },
  maintainers: [{ name: 'new-maintainer', email: 'maintainer@example.test' }],
  versions: {
    '1.0.0': {
      name: 'suspicious-pkg',
      version: '1.0.0',
      deprecated: 'Use safe-pkg instead',
      repository: null,
      scripts: {
        postinstall: 'node postinstall.js',
        test: 'bun test',
      },
      dependencies: {
        'left-pad': '^1.3.0',
      },
    },
  },
};

const scopedPackageResponse = {
  name: '@scope/pkg',
  'dist-tags': { latest: '2.0.0' },
  time: {
    created: '2025-01-01T00:00:00.000Z',
    modified: '2025-02-01T00:00:00.000Z',
    '2.0.0': '2025-02-01T00:00:00.000Z',
  },
  maintainers: [],
  versions: {
    '2.0.0': {
      name: '@scope/pkg',
      version: '2.0.0',
      repository: { url: 'git+https://github.com/scope/pkg.git' },
      scripts: {},
    },
  },
};

describe('npm registry intel component', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers with component metadata', () => {
    const component = componentRegistry.get('sentris.npm.registry.intel');

    expect(component).toBeDefined();
    expect(component?.label).toBe('NPM Registry Intel');
    expect(component?.category).toBe('security');
  });

  it('fetches npm metadata and emits package risk signals', async () => {
    const component = componentRegistry.get<
      NpmRegistryIntelInputSchema,
      NpmRegistryIntelOutputSchema
    >('sentris.npm.registry.intel');
    if (!component) throw new Error('NPM registry intel component was not registered');

    const fetchMock = vi.fn(async (url: string | URL | Request): Promise<Response> => {
      const text = String(url);
      if (text.endsWith('/suspicious-pkg')) {
        return new Response(JSON.stringify(npmPackageResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (text.endsWith('/%40scope%2Fpkg')) {
        return new Response(JSON.stringify(scopedPackageResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('not found', { status: 404 });
    });

    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'npm-registry-intel-test',
    });
    context.http.fetch = fetchMock as unknown as ExecutionContext['http']['fetch'];

    const result = (await component.execute(
      {
        inputs: {
          packageSpecs: ['suspicious-pkg@1.0.0', '@scope/pkg@2.0.0'],
          typosquatCandidates: ['suspicous-pkg'],
        },
        params: {
          maxPackages: 10,
          recentPublishDays: 30,
          includeRawMetadata: false,
        },
      },
      context,
    )) as NpmRegistryIntelOutput;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.records).toHaveLength(2);
    expect(result.records[0]).toMatchObject({
      name: 'suspicious-pkg',
      requestedSpec: 'suspicious-pkg@1.0.0',
      requestedVersion: '1.0.0',
      latest: '1.0.0',
      repositoryUrl: null,
      deprecated: 'Use safe-pkg instead',
      installScripts: ['postinstall'],
      maintainers: [{ name: 'new-maintainer' }],
    });
    expect(result.records[0].rawMetadata).toBeUndefined();

    expect(result.riskSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          packageName: 'suspicious-pkg',
          signal: 'install-script',
          severity: 'high',
        }),
        expect.objectContaining({
          packageName: 'suspicious-pkg',
          signal: 'deprecated',
          severity: 'medium',
        }),
        expect.objectContaining({
          packageName: 'suspicious-pkg',
          signal: 'missing-repository',
          severity: 'medium',
        }),
        expect.objectContaining({
          packageName: 'suspicious-pkg',
          signal: 'recent-publish',
          severity: 'low',
        }),
        expect.objectContaining({
          packageName: 'suspicious-pkg',
          signal: 'typosquat-similarity',
          severity: 'medium',
        }),
      ]),
    );
    expect(result.summary).toMatchObject({
      packagesChecked: 2,
      recordsFetched: 2,
      warnings: 0,
      packagesWithSignals: 1,
      riskSignals: 5,
      countsBySeverity: { high: 1, medium: 3, low: 1 },
    });
  });

  it('returns warnings for missing packages without failing the batch', async () => {
    const component = componentRegistry.get<
      NpmRegistryIntelInputSchema,
      NpmRegistryIntelOutputSchema
    >('sentris.npm.registry.intel');
    if (!component) throw new Error('NPM registry intel component was not registered');

    const fetchMock = vi.fn(
      async (): Promise<Response> => new Response('not found', { status: 404 }),
    );
    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'npm-registry-intel-missing',
    });
    context.http.fetch = fetchMock as unknown as ExecutionContext['http']['fetch'];

    const result = (await component.execute(
      {
        inputs: {
          packageSpecs: ['missing-pkg@1.0.0'],
          typosquatCandidates: [],
        },
        params: {
          maxPackages: 10,
          recentPublishDays: 30,
          includeRawMetadata: false,
        },
      },
      context,
    )) as NpmRegistryIntelOutput;

    expect(result.records).toEqual([]);
    expect(result.riskSignals).toEqual([]);
    expect(result.warnings).toEqual(['registry fetch failed for missing-pkg: HTTP 404']);
    expect(result.summary).toMatchObject({
      packagesChecked: 1,
      recordsFetched: 0,
      warnings: 1,
    });
  });
});
