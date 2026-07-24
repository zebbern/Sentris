import { describe, it, expect } from 'bun:test';
import { extractAssets } from '../asset-extractor';

describe('extractAssets', () => {
  it('extracts subdomains from subfinder output (value = the subdomain)', () => {
    const out = extractAssets({
      componentId: 'sentris.subfinder.run',
      nodeRef: 'n1',
      runId: 'r1',
      outputs: { subdomains: ['a.example.com', 'b.example.com'] },
    });
    expect(out.map((a) => a.assetType)).toEqual(['subdomain', 'subdomain']);
    expect(out.map((a) => a.assetValue).sort()).toEqual(['a.example.com', 'b.example.com']);
    expect(out[0]?.sourceComponentId).toBe('sentris.subfinder.run');
  });

  it('extracts http-probe assets with url from metadata (not the human string)', () => {
    const out = extractAssets({
      componentId: 'sentris.httpx.scan',
      nodeRef: 'n',
      runId: 'r',
      outputs: { responses: [{ url: 'https://x.example.com', statusCode: 200 }] },
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ assetType: 'http-probe', assetValue: 'https://x.example.com' });
    expect(out[0]?.metadata).toMatchObject({ statusCode: 200 });
  });

  it('extracts open-port assets from naabu (value = host:port)', () => {
    const out = extractAssets({
      componentId: 'sentris.naabu.scan',
      nodeRef: 'n',
      runId: 'r',
      outputs: { findings: [{ host: 'h.example.com', port: 8080, protocol: 'tcp' }] },
    });
    expect(out[0]?.assetType).toBe('open-port');
    expect(out[0]?.assetValue).toBe('h.example.com:8080');
    expect(out[0]?.metadata).toMatchObject({ host: 'h.example.com', port: 8080 });
  });

  it('extracts dns-record assets from dnsx (value = host)', () => {
    const out = extractAssets({
      componentId: 'sentris.dnsx.run',
      nodeRef: 'n',
      runId: 'r',
      outputs: { dnsRecords: [{ host: 'mail.example.com', type: 'A' }] },
    });
    expect(out[0]).toMatchObject({ assetType: 'dns-record', assetValue: 'mail.example.com' });
  });

  it('extracts crawled-url assets from katana', () => {
    const out = extractAssets({
      componentId: 'sentris.katana.run',
      nodeRef: 'n',
      runId: 'r',
      outputs: { endpoints: ['https://x.example.com/login'] },
    });
    expect(out[0]).toMatchObject({
      assetType: 'crawled-url',
      assetValue: 'https://x.example.com/login',
    });
  });

  it('extracts subdomains + ip-address from theHarvester but DROPS emails', () => {
    const out = extractAssets({
      componentId: 'sentris.theharvester.run',
      nodeRef: 'n',
      runId: 'r',
      outputs: {
        emails: ['a@example.com'],
        subdomains: ['dev.example.com'],
        ips: ['1.2.3.4'],
      },
    });
    const types = out.map((a) => a.assetType).sort();
    expect(types).toEqual(['ip-address', 'subdomain']);
    expect(out.find((a) => a.assetType === 'ip-address')?.assetValue).toBe('1.2.3.4');
  });

  it('returns [] for a non-recon component (nuclei)', () => {
    expect(
      extractAssets({
        componentId: 'sentris.nuclei.scan',
        nodeRef: 'n',
        runId: 'r',
        outputs: { findings: [{ name: 'x', severity: 'high' }] },
      }),
    ).toEqual([]);
  });

  it('dedupes identical assets within a single batch', () => {
    const out = extractAssets({
      componentId: 'sentris.subfinder.run',
      nodeRef: 'n',
      runId: 'r',
      outputs: { subdomains: ['dup.example.com', 'dup.example.com'] },
    });
    expect(out).toHaveLength(1);
  });

  it('skips empty/whitespace asset values', () => {
    const out = extractAssets({
      componentId: 'sentris.subfinder.run',
      nodeRef: 'n',
      runId: 'r',
      outputs: { subdomains: ['', '  '] },
    });
    expect(out).toEqual([]);
  });

  it('returns [] when outputs is null', () => {
    expect(
      extractAssets({
        componentId: 'sentris.subfinder.run',
        nodeRef: 'n',
        runId: 'r',
        outputs: null,
      }),
    ).toEqual([]);
  });
});
