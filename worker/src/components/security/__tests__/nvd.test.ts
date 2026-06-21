import { afterEach, describe, expect, it, vi } from 'bun:test';
import {
  componentRegistry,
  createExecutionContext,
  type ExecutionContext,
} from '@sentris/component-sdk';
import { buildNvdCveUrl, type NvdCveInput, type NvdCveOutput } from '../nvd';
import '../nvd';

const sampleNvdResponse = {
  resultsPerPage: 1,
  startIndex: 0,
  totalResults: 1,
  vulnerabilities: [
    {
      cve: {
        id: 'CVE-2024-3094',
        published: '2024-03-29T17:15:07.547',
        lastModified: '2025-02-01T15:15:00.000',
        vulnStatus: 'Analyzed',
        descriptions: [
          {
            lang: 'en',
            value: 'Sample backdoor vulnerability description.',
          },
        ],
      },
    },
  ],
};

describe('NVD CVE query component', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers with component metadata', () => {
    const component = componentRegistry.get('sentris.nvd.cve.query');

    expect(component).toBeDefined();
    expect(component?.label).toBe('NVD CVE Query');
    expect(component?.category).toBe('security');
  });

  it('builds cveIds queries and excludes rejected CVEs by default', () => {
    const url = buildNvdCveUrl({
      cveIds: [' cve-2024-3094 ', 'CVE-2024-3094', 'CVE-2021-44228'],
      keywordSearch: '',
      resultsPerPage: 50,
      includeRejected: false,
    });

    expect(url).toContain('https://services.nvd.nist.gov/rest/json/cves/2.0?');
    expect(url).toContain('cveIds=CVE-2024-3094%2CCVE-2021-44228');
    expect(url).toContain('resultsPerPage=50');
    expect(url).toContain('startIndex=0');
    expect(url).toContain('noRejected');
    expect(url).not.toContain('cveId=');
  });

  it('builds keywordSearch queries when no CVE IDs are supplied', () => {
    const url = buildNvdCveUrl({
      cveIds: [],
      keywordSearch: 'apache airflow',
      resultsPerPage: 20,
      includeRejected: true,
    });

    expect(url).toContain('keywordSearch=apache+airflow');
    expect(url).toContain('resultsPerPage=20');
    expect(url).not.toContain('noRejected');
  });

  it('queries NVD, forwards apiKey as a header, and returns source health metadata', async () => {
    const component = componentRegistry.get<NvdCveInput, NvdCveOutput>('sentris.nvd.cve.query');
    if (!component) throw new Error('NVD CVE component was not registered');

    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe('GET');
      expect((init?.headers as Record<string, string>).apiKey).toBe('nvd-test-key');
      return new Response(JSON.stringify(sampleNvdResponse), {
        status: 200,
        statusText: 'OK',
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'nvd-test',
    });
    context.http.fetch = fetchMock as unknown as ExecutionContext['http']['fetch'];

    const result = await component.execute(
      {
        inputs: {
          cveIds: ['CVE-2024-3094'],
          keywordSearch: '',
          apiKey: 'nvd-test-key',
        },
        params: {
          resultsPerPage: 20,
          includeRejected: false,
          timeoutMs: 30000,
          failOnUnavailable: false,
        },
      },
      context,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ok: true,
      status: 200,
      statusText: 'OK',
      warnings: [],
      totalResults: 1,
      returnedResults: 1,
    });
    expect(result.vulnerabilities).toHaveLength(1);
    expect(result.dataSource).toMatchObject({
      name: 'nvd',
      ok: true,
      status: 200,
      statusText: 'OK',
    });
    expect(result.data).toEqual(sampleNvdResponse);
  });

  it('returns a non-fatal timeout result when failOnUnavailable is false', async () => {
    const component = componentRegistry.get<NvdCveInput, NvdCveOutput>('sentris.nvd.cve.query');
    if (!component) throw new Error('NVD CVE component was not registered');

    const timeoutError = new DOMException('The operation was aborted.', 'AbortError');
    const fetchMock = vi.fn(async () => {
      throw timeoutError;
    });

    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'nvd-timeout-test',
    });
    context.http.fetch = fetchMock as unknown as ExecutionContext['http']['fetch'];

    const result = await component.execute(
      {
        inputs: {
          cveIds: [],
          keywordSearch: 'nginx',
          apiKey: '',
        },
        params: {
          resultsPerPage: 5,
          includeRejected: false,
          timeoutMs: 1000,
          failOnUnavailable: false,
        },
      },
      context,
    );

    expect(result).toMatchObject({
      ok: false,
      status: 0,
      statusText: 'Timeout',
      vulnerabilities: [],
      totalResults: 0,
      returnedResults: 0,
    });
    expect(result.warnings).toEqual(['NVD CVE query unavailable: Timeout']);
    expect(result.data).toEqual({ error: 'Timeout' });
  });
});
