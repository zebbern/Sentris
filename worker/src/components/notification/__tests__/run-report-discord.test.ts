import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { ConfigurationError, type HttpRequestInput } from '@sentris/component-sdk';

const mockFetch = mock(async (_input: HttpRequestInput) => new Response('', { status: 204 }));
const mockToCurl = mock((_input: HttpRequestInput) => 'curl "<redacted>"');

const definitionPromise = (async () => {
  const { componentRegistry } = await import('@sentris/component-sdk');
  await import('../run-report-discord.js');
  return componentRegistry.get('core.notification.run-report-discord');
})();

describe('Run Report → Discord component', () => {
  beforeEach(() => {
    process.env.INTERNAL_SERVICE_TOKEN = 'internal-token';
    process.env.SENTRIS_API_BASE_URL = 'http://localhost:3211';
    mockFetch.mockReset();
    mockToCurl.mockReset();
    mockFetch.mockImplementation(async () => new Response('', { status: 204 }));
    mockToCurl.mockImplementation(() => 'curl "<redacted>"');
  });

  it('posts summary and findings bundles to Discord', async () => {
    mockFetch.mockImplementation(async (input: HttpRequestInput) => {
      const url = String(input);
      if (url.includes('/internal/runs/run-123')) {
        if (url.endsWith('/node-io')) {
          return Response.json({
            nodes: [
              {
                nodeRef: 'nuclei_1',
                componentId: 'sentris.nuclei.scan',
                status: 'completed',
                outputs: {
                  findings: [
                    {
                      name: 'test-template',
                      templateId: 'tpl-1',
                      matchedAt: 'https://example.test',
                      severity: 'high',
                    },
                  ],
                },
              },
            ],
          });
        }
        if (url.endsWith('/artifacts')) {
          return Response.json({ artifacts: [] });
        }
        return Response.json({
          id: 'run-123',
          workflowId: 'wf-1',
          status: 'COMPLETED',
          endTime: '2026-06-21T12:00:00.000Z',
        });
      }
      return new Response('', { status: 204 });
    });

    const definition = await definitionPromise;
    if (!definition) throw new Error('core.notification.run-report-discord is not registered');
    const result = await definition.execute(
      {
        inputs: {
          webhookUrl: 'https://discord.com/api/webhooks/1234567890/abcdefghijklmnop',
        },
        params: {
          includeSummary: true,
          includeFindings: true,
          includeArtifacts: false,
          attachFindingsJson: true,
          attachFirstArtifact: false,
          findingsLimit: 25,
        },
      },
      {
        runId: 'run-123',
        workflowId: 'wf-1',
        organizationId: 'org-1',
        componentRef: 'run_report_1',
        metadata: { runId: 'run-123', componentRef: 'run_report_1', organizationId: 'org-1' },
        emitProgress: () => {},
        logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
        http: { fetch: mockFetch, toCurl: mockToCurl },
        artifacts: {} as never,
      },
    );

    expect(result.ok).toBe(true);
    expect(result.findingsCount).toBe(1);
    expect(mockFetch).toHaveBeenCalled();
    const discordCall = mockFetch.mock.calls.find((call) =>
      String(call[0]).includes('discord.com/api/webhooks'),
    );
    expect(discordCall).toBeDefined();
  });

  it('ignores the optional Run after dependency input', async () => {
    mockFetch.mockImplementation(async (input: HttpRequestInput) => {
      const url = String(input);
      if (url.includes('/internal/runs/run-123')) {
        if (url.endsWith('/node-io')) {
          return Response.json({ nodes: [] });
        }
        if (url.endsWith('/artifacts')) {
          return Response.json({ artifacts: [] });
        }
        return Response.json({
          id: 'run-123',
          workflowId: 'wf-1',
          status: 'COMPLETED',
        });
      }
      return new Response('', { status: 204 });
    });

    const definition = await definitionPromise;
    if (!definition) throw new Error('core.notification.run-report-discord is not registered');
    const result = await definition.execute(
      {
        inputs: {
          after: { saved: true, artifactName: 'ignored.json' },
          webhookUrl: 'https://discord.com/api/webhooks/1234567890/abcdefghijklmnop',
        },
        params: {
          includeSummary: true,
          includeFindings: false,
          includeArtifacts: false,
          attachFindingsJson: false,
          attachFirstArtifact: false,
          findingsLimit: 25,
        },
      },
      {
        runId: 'run-123',
        workflowId: 'wf-1',
        organizationId: 'org-1',
        componentRef: 'run_report_1',
        metadata: { runId: 'run-123', componentRef: 'run_report_1', organizationId: 'org-1' },
        emitProgress: () => {},
        logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
        http: { fetch: mockFetch, toCurl: mockToCurl },
        artifacts: {} as never,
      },
    );

    expect(result.ok).toBe(true);
  });

  it('requires INTERNAL_SERVICE_TOKEN', async () => {
    delete process.env.INTERNAL_SERVICE_TOKEN;
    const definition = await definitionPromise;
    if (!definition) throw new Error('core.notification.run-report-discord is not registered');

    await expect(
      definition.execute(
        {
          inputs: {
            webhookUrl: 'https://discord.com/api/webhooks/1234567890/abcdefghijklmnop',
          },
          params: {
            includeSummary: true,
            includeFindings: false,
            includeArtifacts: false,
            attachFindingsJson: false,
            attachFirstArtifact: false,
            findingsLimit: 25,
          },
        },
        {
          runId: 'run-123',
          workflowId: 'wf-1',
          organizationId: 'org-1',
          componentRef: 'run_report_1',
          metadata: { runId: 'run-123', componentRef: 'run_report_1', organizationId: 'org-1' },
          emitProgress: () => {},
          logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
          http: { fetch: mockFetch, toCurl: mockToCurl },
          artifacts: {} as never,
        },
      ),
    ).rejects.toBeInstanceOf(ConfigurationError);
  });
});
