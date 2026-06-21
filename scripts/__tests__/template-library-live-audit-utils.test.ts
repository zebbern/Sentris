import { describe, expect, it } from 'bun:test';
import {
  getNodeIoWarningSignals,
  renderTemplateAuditMarkdown,
  summarizeNodeIoNode,
  waitForNodeIoEvidence,
} from '../template-library-live-audit-utils';

describe('template library live audit helpers', () => {
  it('waits for node I/O ingestion to reach the expected node count', async () => {
    const sleeps: number[] = [];
    const responses = [
      { runId: 'run-1', nodes: [] },
      { runId: 'run-1', nodes: [{ nodeRef: 'trigger_1' }] },
      {
        runId: 'run-1',
        nodes: [{ nodeRef: 'trigger_1' }, { nodeRef: 'osv_query' }],
      },
    ];

    const result = await waitForNodeIoEvidence({
      runId: 'run-1',
      expectedNodeCount: 2,
      timeoutMs: 1000,
      pollIntervalMs: 25,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      fetchNodeIo: async () => responses.shift() ?? { runId: 'run-1', nodes: [] },
    });

    expect(result.nodes).toHaveLength(2);
    expect(sleeps).toEqual([25, 25]);
  });

  it('summarizes output keys when node outputs are a JSON string', () => {
    const summary = summarizeNodeIoNode({
      nodeRef: 'query_nvd_candidates',
      componentId: 'sentris.nvd.cve.query',
      status: 'completed',
      durationMs: 1250,
      outputs: JSON.stringify({
        ok: true,
        status: 200,
        vulnerabilities: [],
      }),
      outputsSpilled: true,
      outputsTruncated: false,
      inputsSpilled: false,
      inputsTruncated: false,
    });

    expect(summary).toEqual({
      nodeRef: 'query_nvd_candidates',
      componentId: 'sentris.nvd.cve.query',
      status: 'completed',
      durationMs: 1250,
      errorMessage: null,
      inputKeys: [],
      outputKeys: ['ok', 'status', 'vulnerabilities'],
      warnings: [],
      inputsSpilled: false,
      inputsTruncated: false,
      outputsSpilled: true,
      outputsTruncated: false,
    });
  });

  it('extracts warning signals from node outputs', () => {
    const summary = summarizeNodeIoNode({
      nodeRef: 'query_nvd_candidates',
      componentId: 'sentris.nvd.cve.query',
      status: 'completed',
      outputs: {
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        warnings: ['NVD CVE query unavailable: Service Unavailable'],
      },
    });

    expect(summary.warnings).toEqual(['NVD CVE query unavailable: Service Unavailable']);
    expect(getNodeIoWarningSignals([summary])).toEqual([
      'query_nvd_candidates: NVD CVE query unavailable: Service Unavailable',
    ]);
  });

  it('keeps truncation flags when serialized node outputs cannot be parsed', () => {
    const summary = summarizeNodeIoNode({
      nodeRef: 'rank_cve_candidates',
      status: 'completed',
      outputs: '{"report":',
      outputsSpilled: true,
      outputsTruncated: true,
    });

    expect(summary.outputKeys).toEqual([]);
    expect(summary.outputsSpilled).toBe(true);
    expect(summary.outputsTruncated).toBe(true);
  });

  it('renders node I/O evidence in the audit markdown report', () => {
    const markdown = renderTemplateAuditMarkdown({
      apiBase: 'http://127.0.0.1:3211/api/v1',
      outputRoot: 'C:/tmp/audit',
      generatedAt: '2026-06-21T04:00:00.000Z',
      results: [
        {
          templateId: 'tpl-1',
          templateName: 'Exposed Service CVE Mapper',
          seedFile: 'exposed-service-cve-mapper.json',
          category: 'cve-research',
          components: ['sentris.nvd.cve.query'],
          requiredSecrets: [],
          runtimeInputs: [],
          classification: 'live-run',
          createOk: true,
          runAttempted: true,
          terminalStatus: 'COMPLETED',
          artifactsCount: 1,
          recommendation: 'keep',
          rationale: 'Live execution completed and produced at least one artifact.',
          nodeIo: [
            {
              nodeRef: 'query_nvd_candidates',
              componentId: 'sentris.nvd.cve.query',
              status: 'completed',
              durationMs: 1250,
              errorMessage: null,
              inputKeys: ['keywordSearch'],
              outputKeys: ['ok', 'status', 'vulnerabilities'],
              warnings: [],
              inputsSpilled: false,
              inputsTruncated: false,
              outputsSpilled: true,
              outputsTruncated: false,
            },
          ],
        },
      ],
    });

    expect(markdown).toContain('## Node I/O Evidence');
    expect(markdown).toContain('### Exposed Service CVE Mapper');
    expect(markdown).toContain('query_nvd_candidates');
    expect(markdown).toContain('sentris.nvd.cve.query');
    expect(markdown).toContain('ok, status, vulnerabilities');
    expect(markdown).toContain('outputs spilled');
  });
});
