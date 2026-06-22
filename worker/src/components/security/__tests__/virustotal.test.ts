import { afterEach, beforeAll, describe, expect, it, vi } from 'bun:test';
import * as sdk from '@sentris/component-sdk';
import { componentRegistry } from '@sentris/component-sdk';

describe('virustotal component', () => {
  beforeAll(async () => {
    await import('../virustotal');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes domain indicators to the VirusTotal domains endpoint', async () => {
    const component = componentRegistry.get<any, any>('security.virustotal.lookup');
    if (!component) throw new Error('VirusTotal component was not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'virustotal-domain',
    });

    const fetchSpy = vi.spyOn(context.http, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            attributes: {
              last_analysis_stats: {
                malicious: 1,
                suspicious: 0,
                harmless: 70,
              },
              tags: ['malware'],
              reputation: 10,
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const result = (await component.execute(
      {
        inputs: {
          indicator: 'example.com',
          apiKey: 'test-key',
        },
        params: {
          type: 'domain',
        },
      },
      context,
    )) as { malicious: number; tags: string[] };

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://www.virustotal.com/api/v3/domains/example.com',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ 'x-apikey': 'test-key' }),
      }),
    );
    expect(result.malicious).toBe(1);
    expect(result.tags).toEqual(['malware']);
  });

  it('base64-url encodes URL indicators without padding', async () => {
    const component = componentRegistry.get<any, any>('security.virustotal.lookup');
    if (!component) throw new Error('VirusTotal component was not registered');

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'virustotal-url',
    });

    const fetchSpy = vi.spyOn(context.http, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            attributes: {
              last_analysis_stats: { malicious: 0, suspicious: 0, harmless: 0 },
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await component.execute(
      {
        inputs: {
          indicator: 'https://example.com/path',
          apiKey: 'test-key',
        },
        params: {
          type: 'url',
        },
      },
      context,
    );

    const requestedUrl = String(fetchSpy.mock.calls[0]?.[0]);
    expect(requestedUrl.startsWith('https://www.virustotal.com/api/v3/urls/')).toBe(true);
    expect(requestedUrl).not.toContain('=');
  });
});
