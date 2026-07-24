import { describe, it, expect } from 'bun:test';
import { extractAssets } from '../asset-extractor';

describe('extractAssets', () => {
  it('extracts subdomains from subfinder output (assetValue from finding string)', () => {
    const out = extractAssets({
      componentId: 'sentris.subfinder.run',
      nodeRef: 'n1',
      runId: 'r1',
      outputs: { subdomains: ['a.example.com', 'b.example.com'] },
    });
    expect(out.map((a) => a.assetType)).toEqual(['subdomain', 'subdomain']);
    expect(out.map((a) => a.assetValue).sort()).toEqual(['a.example.com', 'b.example.com']);
    expect(out[0].sourceComponentId).toBe('sentris.subfinder.run');
    // subfinder's normalizer sets no metadata, so extractAssets falls back to {}
    expect(out[0].metadata).toEqual({});
  });

  it('extracts http-probe assets with assetValue from metadata.url', () => {
    const out = extractAssets({
      componentId: 'sentris.httpx.scan',
      nodeRef: 'n',
      runId: 'r',
      outputs: { responses: [{ url: 'https://x.example.com', statusCode: 200 }] },
    });
    expect(out[0]).toMatchObject({ assetType: 'http-probe', assetValue: 'https://x.example.com' });
    expect(out[0].metadata.url).toBe('https://x.example.com');
  });

  it('extracts open-port assets with assetValue from metadata.host (not "host:port")', () => {
    const out = extractAssets({
      componentId: 'sentris.naabu.scan',
      nodeRef: 'n',
      runId: 'r',
      outputs: { findings: [{ host: 'h.example.com', port: 8080, protocol: 'tcp' }] },
    });
    expect(out[0].assetType).toBe('open-port');
    // naabu's metadata carries a `host` field, which asset-key's field priority
    // matches before falling back to the "host:port (protocol)" finding string.
    expect(out[0].assetValue).toBe('h.example.com');
    expect(out[0].metadata).toMatchObject({ host: 'h.example.com', port: 8080, protocol: 'tcp' });
  });

  it('extracts dns-record assets with assetValue from metadata.host', () => {
    const out = extractAssets({
      componentId: 'sentris.dnsx.run',
      nodeRef: 'n',
      runId: 'r',
      outputs: {
        dnsRecords: [{ host: 'sub.example.com', answers: { a: ['1.2.3.4'] } }],
      },
    });
    expect(out[0].assetType).toBe('dns-record');
    expect(out[0].assetValue).toBe('sub.example.com');
  });

  it('extracts crawled-url assets from katana (assetValue from finding string)', () => {
    const out = extractAssets({
      componentId: 'sentris.katana.run',
      nodeRef: 'n',
      runId: 'r',
      outputs: { endpoints: ['https://x.example.com/admin'] },
    });
    expect(out[0]).toMatchObject({
      assetType: 'crawled-url',
      assetValue: 'https://x.example.com/admin',
    });
  });

  it('extracts subdomain and ip-address assets from theHarvester, skipping emails', () => {
    const out = extractAssets({
      componentId: 'sentris.theharvester.run',
      nodeRef: 'n',
      runId: 'r',
      outputs: {
        emails: ['person@example.com'],
        subdomains: ['th.example.com'],
        ips: ['5.6.7.8'],
      },
    });
    expect(out.map((a) => a.assetType).sort()).toEqual(['ip-address', 'subdomain']);
    expect(out.find((a) => a.assetType === 'subdomain')?.assetValue).toBe('th.example.com');
    expect(out.find((a) => a.assetType === 'ip-address')?.assetValue).toBe('5.6.7.8');
  });

  it('returns [] for a non-recon component', () => {
    expect(
      extractAssets({
        componentId: 'sentris.nuclei.scan',
        nodeRef: 'n',
        runId: 'r',
        outputs: { findings: [{}] },
      }),
    ).toEqual([]);
  });

  it('dedupes identical assets within a batch', () => {
    const out = extractAssets({
      componentId: 'sentris.subfinder.run',
      nodeRef: 'n',
      runId: 'r',
      outputs: { subdomains: ['dup.example.com', 'dup.example.com'] },
    });
    expect(out).toHaveLength(1);
  });
});
