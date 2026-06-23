import { afterEach, describe, expect, it, vi } from 'bun:test';
import {
  componentRegistry,
  createExecutionContext,
  type ExecutionContext,
} from '@sentris/component-sdk';
import {
  extractFixedVersions,
  inferOsvSeverity,
  parsePackageSpec,
  type OsvInput,
  type OsvOutput,
} from '../osv';
import '../osv';

const sampleAdvisory = {
  id: 'GHSA-test',
  summary: 'Prototype Pollution in test package',
  aliases: ['CVE-2026-12345'],
  modified: '2026-01-01T00:00:00Z',
  published: '2025-12-01T00:00:00Z',
  database_specific: {
    severity: 'HIGH',
  },
  references: [
    {
      type: 'ADVISORY',
      url: 'https://nvd.nist.gov/vuln/detail/CVE-2026-12345',
    },
  ],
  affected: [
    {
      package: {
        ecosystem: 'npm',
        name: 'lodash',
      },
      ranges: [
        {
          type: 'SEMVER',
          events: [{ introduced: '0' }, { fixed: '4.17.21' }],
        },
      ],
    },
  ],
};

describe('OSV dependency query component', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers with component metadata', () => {
    const component = componentRegistry.get('sentris.osv.query');

    expect(component).toBeDefined();
    expect(component?.label).toBe('OSV Dependency Advisory Query');
    expect(component?.category).toBe('security');
  });

  it('parses npm package specs with scoped package support', () => {
    expect(parsePackageSpec('lodash@4.17.20', 'npm')).toEqual({
      spec: 'lodash@4.17.20',
      name: 'lodash',
      version: '4.17.20',
      ecosystem: 'npm',
    });
    expect(parsePackageSpec('@scope/pkg@1.2.3', 'npm')).toEqual({
      spec: '@scope/pkg@1.2.3',
      name: '@scope/pkg',
      version: '1.2.3',
      ecosystem: 'npm',
    });
    expect(parsePackageSpec('axios', 'npm')).toEqual({
      spec: 'axios',
      name: 'axios',
      version: null,
      ecosystem: 'npm',
    });
    expect(parsePackageSpec('', 'npm')).toBeNull();
  });

  it('parses per-spec OSV ecosystem prefixes for mixed dependency evidence', () => {
    expect(parsePackageSpec('PyPI:django@4.2.7', 'npm')).toEqual({
      spec: 'PyPI:django@4.2.7',
      name: 'django',
      version: '4.2.7',
      ecosystem: 'PyPI',
    });
    expect(parsePackageSpec('Go:golang.org/x/net@v0.17.0', 'npm')).toEqual({
      spec: 'Go:golang.org/x/net@v0.17.0',
      name: 'golang.org/x/net',
      version: 'v0.17.0',
      ecosystem: 'Go',
    });
    expect(parsePackageSpec('Maven:org.apache.logging.log4j:log4j-core@2.14.1', 'npm')).toEqual({
      spec: 'Maven:org.apache.logging.log4j:log4j-core@2.14.1',
      name: 'org.apache.logging.log4j:log4j-core',
      version: '2.14.1',
      ecosystem: 'Maven',
    });
    expect(parsePackageSpec('npm:@scope/pkg@1.2.3', 'PyPI')).toEqual({
      spec: 'npm:@scope/pkg@1.2.3',
      name: '@scope/pkg',
      version: '1.2.3',
      ecosystem: 'npm',
    });
  });

  it('keeps Maven coordinates intact when no explicit ecosystem prefix is present', () => {
    expect(parsePackageSpec('org.apache.logging.log4j:log4j-core@2.14.1', 'Maven')).toEqual({
      spec: 'org.apache.logging.log4j:log4j-core@2.14.1',
      name: 'org.apache.logging.log4j:log4j-core',
      version: '2.14.1',
      ecosystem: 'Maven',
    });
  });

  it('infers severity and fixed versions from hydrated OSV advisories', () => {
    expect(inferOsvSeverity(sampleAdvisory)).toBe('high');
    expect(extractFixedVersions(sampleAdvisory)).toEqual(['4.17.21']);
  });

  it('infers critical severity from critical CVSS vectors', () => {
    expect(
      inferOsvSeverity({
        severity: [
          {
            type: 'CVSS_V3',
            score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
          },
        ],
      }),
    ).toBe('critical');
  });

  it('queries OSV, hydrates advisories, and emits analytics-ready results', async () => {
    const component = componentRegistry.get<OsvInput, OsvOutput>('sentris.osv.query');
    if (!component) throw new Error('OSV component was not registered');

    const fetchMock = vi.fn(async (url: string | URL | Request): Promise<Response> => {
      const text = String(url);
      if (text.endsWith('/v1/querybatch')) {
        return new Response(
          JSON.stringify({
            results: [{ vulns: [{ id: 'GHSA-test', modified: '2026-01-01T00:00:00Z' }] }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (text.endsWith('/v1/vulns/GHSA-test')) {
        return new Response(JSON.stringify(sampleAdvisory), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('not found', { status: 404 });
    });

    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'osv-test',
    });
    context.http.fetch = fetchMock as unknown as ExecutionContext['http']['fetch'];

    const result = await component.execute(
      {
        inputs: {
          packageSpecs: ['lodash@4.17.20'],
        },
        params: {
          ecosystem: 'npm',
          severityFloor: 'medium',
          hydrateAdvisories: true,
          maxAdvisoriesPerPackage: 50,
          includeUnknownSeverity: true,
        },
      },
      context,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.summary).toEqual({
      packagesChecked: 1,
      vulnerablePackages: 1,
      findings: 1,
      maliciousPackageRecords: 0,
      countsBySeverity: { high: 1 },
    });
    expect(result.findings[0]).toMatchObject({
      packageSpec: 'lodash@4.17.20',
      packageName: 'lodash',
      version: '4.17.20',
      id: 'GHSA-test',
      cves: ['CVE-2026-12345'],
      fixedVersions: ['4.17.21'],
      severity: 'high',
      summary: 'Prototype Pollution in test package',
    });
    expect(result.results[0]).toMatchObject({
      scanner: 'osv',
      severity: 'high',
      asset_key: 'lodash@4.17.20',
      vulnerability_id: 'GHSA-test',
      package_name: 'lodash',
      installed_version: '4.17.20',
      fixed_versions: ['4.17.21'],
    });
  });

  it('sends per-spec ecosystems in one OSV query batch', async () => {
    const component = componentRegistry.get<OsvInput, OsvOutput>('sentris.osv.query');
    if (!component) throw new Error('OSV component was not registered');

    let queryBody: unknown;
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
        queryBody = JSON.parse(String(init?.body ?? '{}'));
        return new Response(
          JSON.stringify({ results: [{ vulns: [] }, { vulns: [] }, { vulns: [] }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      },
    );

    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'osv-mixed',
    });
    context.http.fetch = fetchMock as unknown as ExecutionContext['http']['fetch'];

    const result = await component.execute(
      {
        inputs: {
          packageSpecs: [
            'npm:lodash@4.17.20',
            'PyPI:django@4.2.7',
            'Maven:org.apache.logging.log4j:log4j-core@2.14.1',
          ],
        },
        params: {
          ecosystem: 'npm',
          severityFloor: 'unknown',
          hydrateAdvisories: false,
          maxAdvisoriesPerPackage: 50,
          includeUnknownSeverity: true,
        },
      },
      context,
    );

    expect(queryBody).toEqual({
      queries: [
        { package: { name: 'lodash', ecosystem: 'npm' }, version: '4.17.20' },
        { package: { name: 'django', ecosystem: 'PyPI' }, version: '4.2.7' },
        {
          package: { name: 'org.apache.logging.log4j:log4j-core', ecosystem: 'Maven' },
          version: '2.14.1',
        },
      ],
    });
    expect(result.packages).toEqual([
      { spec: 'npm:lodash@4.17.20', name: 'lodash', version: '4.17.20', ecosystem: 'npm' },
      { spec: 'PyPI:django@4.2.7', name: 'django', version: '4.2.7', ecosystem: 'PyPI' },
      {
        spec: 'Maven:org.apache.logging.log4j:log4j-core@2.14.1',
        name: 'org.apache.logging.log4j:log4j-core',
        version: '2.14.1',
        ecosystem: 'Maven',
      },
    ]);
  });

  it('returns empty outputs when upstream package specs are empty', async () => {
    const component = componentRegistry.get<OsvInput, OsvOutput>('sentris.osv.query');
    if (!component) throw new Error('OSV component was not registered');

    const fetchMock = vi.fn();
    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'osv-empty',
    });
    context.http.fetch = fetchMock as unknown as ExecutionContext['http']['fetch'];

    const result = await component.execute(
      {
        inputs: {
          packageSpecs: [],
        },
        params: {
          ecosystem: 'PyPI',
          severityFloor: 'medium',
          hydrateAdvisories: true,
          maxAdvisoriesPerPackage: 50,
          includeUnknownSeverity: true,
        },
      },
      context,
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.summary).toEqual({
      packagesChecked: 0,
      vulnerablePackages: 0,
      findings: 0,
      maliciousPackageRecords: 0,
      countsBySeverity: {},
    });
    expect(result.findings).toEqual([]);
    expect(result.packages).toEqual([]);
    expect(result.results).toEqual([]);
  });
});
