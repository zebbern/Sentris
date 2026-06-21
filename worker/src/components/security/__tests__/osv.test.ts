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

  it('infers severity and fixed versions from hydrated OSV advisories', () => {
    expect(inferOsvSeverity(sampleAdvisory)).toBe('high');
    expect(extractFixedVersions(sampleAdvisory)).toEqual(['4.17.21']);
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
});
