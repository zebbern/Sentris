import { describe, expect, it } from 'bun:test';
import {
  createTemplateValidationFingerprint,
  createTemplateLiveAuditInputs,
  getLiveRunAuditFailures,
  getNodeIoWarningSignals,
  getTemplateCatalogQualityFailures,
  renderTemplateCatalogQualityCheck,
  renderTemplateValidationLedgerFreshness,
  summarizeTemplateValidationLedgerFreshness,
  renderTemplateAuditMarkdown,
  parseTemplateAuditCliOptions,
  resolveTemplateAuditSecretMappings,
  shouldSkipTemplateValidation,
  summarizeNodeIoNode,
  upsertTemplateValidationLedger,
  waitForNodeIoEvidence,
} from '../template-library-live-audit-utils';

describe('template library live audit helpers', () => {
  it('uses real dependency template defaults instead of overriding manifest paths', () => {
    const inputs = createTemplateLiveAuditInputs();

    expect(inputs['GitHub Repo Dependency CVE Triage']).toMatchObject({
      repositoryUrl: 'https://github.com/OWASP/NodeGoat',
      ref: '',
      includeDevDependencies: false,
    });
    expect(inputs['GitHub Repo Dependency CVE Triage']).not.toHaveProperty('manifestPaths');
  });

  it('includes a bounded Discord report live fixture input', () => {
    const inputs = createTemplateLiveAuditInputs();

    expect(inputs['Security Scan Discord Report']).toEqual({
      imageRef: 'alpine:3.18',
    });
  });

  it('resolves audit secret mappings from explicit JSON and per-secret env variables', () => {
    const resolved = resolveTemplateAuditSecretMappings(
      ['DISCORD_WEBHOOK_URL', 'API-TOKEN', 'MISSING_SECRET'],
      {
        TEMPLATE_AUDIT_SECRET_MAPPINGS: JSON.stringify({
          DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/example',
        }),
        TEMPLATE_AUDIT_SECRET_API_TOKEN: 'token-from-env',
      },
    );

    expect(resolved).toEqual({
      secretMappings: {
        DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/example',
        'API-TOKEN': 'token-from-env',
      },
      providedSecretNames: ['DISCORD_WEBHOOK_URL', 'API-TOKEN'],
      missingSecretNames: ['MISSING_SECRET'],
    });
  });

  it('rejects malformed audit secret JSON instead of silently skipping live validation', () => {
    expect(() =>
      resolveTemplateAuditSecretMappings(['DISCORD_WEBHOOK_URL'], {
        TEMPLATE_AUDIT_SECRET_MAPPINGS: '{not-json',
      }),
    ).toThrow('TEMPLATE_AUDIT_SECRET_MAPPINGS must be a JSON object');
  });

  it('parses cross-platform targeted audit CLI flags with environment fallbacks', () => {
    const options = parseTemplateAuditCliOptions(
      [
        '--name',
        'API Surface Exposure Triage',
        '--name=NPM Dependency CVE Hunt',
        '--force',
        '--ledger-check',
        '--org-id',
        'org-1',
      ],
      {
        TEMPLATE_AUDIT_NAMES: 'Bug Bounty Recon Triage',
        TEMPLATE_AUDIT_FORCE: 'false',
        TEMPLATE_AUDIT_LEDGER_CHECK: 'false',
      },
    );

    expect(options.force).toBe(true);
    expect(options.ledgerCheckOnly).toBe(true);
    expect(options.organizationId).toBe('org-1');
    expect(Array.from(options.templateNames)).toEqual([
      'Bug Bounty Recon Triage',
      'API Surface Exposure Triage',
      'NPM Dependency CVE Hunt',
    ]);
  });

  it('creates stable validation fingerprints from template content and live inputs', () => {
    const first = createTemplateValidationFingerprint({
      template: {
        name: 'Example',
        graph: {
          nodes: [{ id: 'a', type: 'core.logic.script' }],
          edges: [],
        },
      },
      liveInputs: { domains: ['example.com'] },
    });
    const reordered = createTemplateValidationFingerprint({
      liveInputs: { domains: ['example.com'] },
      template: {
        graph: {
          edges: [],
          nodes: [{ type: 'core.logic.script', id: 'a' }],
        },
        name: 'Example',
      },
    });
    const changed = createTemplateValidationFingerprint({
      template: {
        name: 'Example',
        graph: {
          nodes: [{ id: 'a', type: 'sentris.httpx.scan' }],
          edges: [],
        },
      },
      liveInputs: { domains: ['example.com'] },
    });

    expect(first).toBe(reordered);
    expect(first).not.toBe(changed);
  });

  it('skips unchanged live templates with successful cached validation', () => {
    const ledger = upsertTemplateValidationLedger(
      undefined,
      {
        templateName: 'Bug Bounty Recon Triage',
        seedFile: 'bug-bounty-recon-triage.json',
        fingerprint: 'sha256:abc',
        terminalStatus: 'COMPLETED',
        recommendation: 'keep',
        rationale: 'Live execution completed and produced at least one artifact.',
        artifactsCount: 1,
      },
      '2026-06-21T04:00:00.000Z',
    );

    const skip = shouldSkipTemplateValidation({
      ledger,
      templateName: 'Bug Bounty Recon Triage',
      classification: 'live-run',
      fingerprint: 'sha256:abc',
      force: false,
    });

    expect(skip?.recommendation).toBe('keep');
    expect(skip?.terminalStatus).toBe('SKIPPED');
    expect(skip?.rationale).toContain('Skipped unchanged template');
  });

  it('does not skip changed, forced, non-live, or degraded cached validations', () => {
    const ledger = upsertTemplateValidationLedger(
      undefined,
      {
        templateName: 'Degraded Live Template',
        seedFile: 'degraded.json',
        fingerprint: 'sha256:abc',
        terminalStatus: 'COMPLETED',
        recommendation: 'review',
        rationale: 'Live execution completed with warnings.',
        artifactsCount: 1,
      },
      '2026-06-21T04:00:00.000Z',
    );

    expect(
      shouldSkipTemplateValidation({
        ledger,
        templateName: 'Degraded Live Template',
        classification: 'live-run',
        fingerprint: 'sha256:abc',
        force: false,
      }),
    ).toBeNull();
    expect(
      shouldSkipTemplateValidation({
        ledger,
        templateName: 'Degraded Live Template',
        classification: 'live-run',
        fingerprint: 'sha256:different',
        force: false,
      }),
    ).toBeNull();
    expect(
      shouldSkipTemplateValidation({
        ledger,
        templateName: 'Degraded Live Template',
        classification: 'live-run',
        fingerprint: 'sha256:abc',
        force: true,
      }),
    ).toBeNull();
    expect(
      shouldSkipTemplateValidation({
        ledger,
        templateName: 'Degraded Live Template',
        classification: 'run-start-probe',
        fingerprint: 'sha256:abc',
        force: false,
      }),
    ).toBeNull();
  });

  it('summarizes current, missing, stale, and degraded validation ledger entries', () => {
    const ledger = {
      version: 1 as const,
      entries: {
        Current: {
          templateName: 'Current',
          seedFile: 'current.json',
          fingerprint: 'sha256:current',
          terminalStatus: 'COMPLETED',
          recommendation: 'keep',
          rationale: 'Live execution completed.',
          artifactsCount: 1,
          verifiedAt: '2026-06-21T04:00:00.000Z',
        },
        Stale: {
          templateName: 'Stale',
          seedFile: 'stale.json',
          fingerprint: 'sha256:old',
          terminalStatus: 'COMPLETED',
          recommendation: 'keep',
          rationale: 'Live execution completed.',
          artifactsCount: 1,
          verifiedAt: '2026-06-21T04:00:00.000Z',
        },
        Degraded: {
          templateName: 'Degraded',
          seedFile: 'degraded.json',
          fingerprint: 'sha256:degraded',
          terminalStatus: 'FAILED',
          recommendation: 'fix',
          rationale: 'Live execution failed.',
          artifactsCount: 0,
          verifiedAt: '2026-06-21T04:00:00.000Z',
        },
      },
    };

    const summary = summarizeTemplateValidationLedgerFreshness(ledger, [
      {
        templateName: 'Current',
        seedFile: 'current.json',
        fingerprint: 'sha256:current',
        classification: 'live-run',
      },
      {
        templateName: 'Missing',
        seedFile: 'missing.json',
        fingerprint: 'sha256:missing',
        classification: 'live-run',
      },
      {
        templateName: 'Stale',
        seedFile: 'stale.json',
        fingerprint: 'sha256:new',
        classification: 'live-run',
      },
      {
        templateName: 'Degraded',
        seedFile: 'degraded.json',
        fingerprint: 'sha256:degraded',
        classification: 'live-run',
      },
      {
        templateName: 'Credential Gated',
        seedFile: 'credential-gated.json',
        fingerprint: 'sha256:credential',
        classification: 'credential-gated',
      },
    ]);

    expect(summary.allLiveRunsCurrent).toBe(false);
    expect(summary.counts).toEqual({
      current: 1,
      missing: 1,
      stale: 1,
      degraded: 1,
      notLiveRun: 1,
    });
    expect(summary.items.map((item) => [item.templateName, item.status])).toEqual([
      ['Current', 'current'],
      ['Missing', 'missing'],
      ['Stale', 'stale'],
      ['Degraded', 'degraded'],
      ['Credential Gated', 'not-live-run'],
    ]);
  });

  it('renders validation ledger freshness as a concise maintenance report', () => {
    const report = renderTemplateValidationLedgerFreshness({
      allLiveRunsCurrent: false,
      counts: {
        current: 1,
        missing: 1,
        stale: 1,
        degraded: 1,
        notLiveRun: 1,
      },
      items: [
        {
          templateName: 'Current',
          seedFile: 'current.json',
          fingerprint: 'sha256:current',
          classification: 'live-run',
          status: 'current',
          verifiedAt: '2026-06-21T04:00:00.000Z',
          rationale: 'Current live validation passed at 2026-06-21T04:00:00.000Z.',
        },
        {
          templateName: 'Missing',
          seedFile: 'missing.json',
          fingerprint: 'sha256:missing',
          classification: 'live-run',
          status: 'missing',
          rationale: 'No successful live-validation ledger entry exists for this template.',
        },
        {
          templateName: 'Stale',
          seedFile: 'stale.json',
          fingerprint: 'sha256:new',
          classification: 'live-run',
          status: 'stale',
          rationale: 'Template, live input, or classification changed after the last validation.',
        },
        {
          templateName: 'Degraded',
          seedFile: 'degraded.json',
          fingerprint: 'sha256:degraded',
          classification: 'live-run',
          status: 'degraded',
          rationale: 'Last validation was FAILED / fix.',
        },
        {
          templateName: 'Credential Gated',
          seedFile: 'credential-gated.json',
          fingerprint: 'sha256:credential',
          classification: 'credential-gated',
          status: 'not-live-run',
          rationale: 'credential-gated templates are not eligible for cached live-run validation.',
        },
      ],
    });

    expect(report).toContain('Live-run validation current: 1/4');
    expect(report).toContain('Missing: 1');
    expect(report).toContain('- missing.json: No successful live-validation ledger entry exists');
    expect(report).toContain('- stale.json: Template, live input, or classification changed');
    expect(report).toContain('- degraded.json: Last validation was FAILED / fix.');
    expect(report).toContain('Non-live-run templates: 1');
  });

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

  it('treats degraded completed live runs as audit failures', () => {
    const failures = getLiveRunAuditFailures([
      {
        templateId: 'tpl-clean',
        templateName: 'Clean Live Template',
        seedFile: 'clean.json',
        category: 'cve-research',
        components: [],
        requiredSecrets: [],
        runtimeInputs: [],
        classification: 'live-run',
        createOk: true,
        runAttempted: true,
        terminalStatus: 'COMPLETED',
        artifactsCount: 1,
        recommendation: 'keep',
        rationale: 'Live execution completed and produced at least one artifact.',
      },
      {
        templateId: 'tpl-degraded',
        templateName: 'Degraded Live Template',
        seedFile: 'degraded.json',
        category: 'cve-research',
        components: [],
        requiredSecrets: [],
        runtimeInputs: [],
        classification: 'live-run',
        createOk: true,
        runAttempted: true,
        terminalStatus: 'COMPLETED',
        artifactsCount: 1,
        recommendation: 'review',
        rationale: 'Live execution completed with artifact but emitted warnings.',
      },
      {
        templateId: 'tpl-skipped',
        templateName: 'Cached Live Template',
        seedFile: 'cached.json',
        category: 'cve-research',
        components: [],
        requiredSecrets: [],
        runtimeInputs: [],
        classification: 'live-run',
        createOk: false,
        runAttempted: false,
        terminalStatus: 'SKIPPED',
        artifactsCount: 1,
        recommendation: 'keep',
        rationale: 'Skipped unchanged template; last live validation passed.',
      },
    ]);

    expect(failures.map((result) => result.templateName)).toEqual(['Degraded Live Template']);
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

  it('renders review candidates in the audit markdown report', () => {
    const markdown = renderTemplateAuditMarkdown({
      apiBase: 'http://127.0.0.1:3211/api/v1',
      outputRoot: 'C:/tmp/audit',
      generatedAt: '2026-06-21T04:00:00.000Z',
      results: [
        {
          templateId: 'tpl-review',
          templateName: 'Degraded Live Template',
          seedFile: 'degraded.json',
          category: 'cve-research',
          components: [],
          requiredSecrets: [],
          runtimeInputs: [],
          classification: 'live-run',
          createOk: true,
          runAttempted: true,
          terminalStatus: 'COMPLETED',
          artifactsCount: 1,
          recommendation: 'review',
          rationale: 'Live execution completed with artifact but emitted warnings.',
        },
      ],
    });

    expect(markdown).toContain('## Review Candidates');
    expect(markdown).toContain(
      '- degraded.json: Live execution completed with artifact but emitted warnings.',
    );
  });

  it('renders catalog quality signals for duplicate and static templates', () => {
    const markdown = renderTemplateAuditMarkdown({
      apiBase: 'http://127.0.0.1:3211/api/v1',
      outputRoot: 'C:/tmp/audit',
      generatedAt: '2026-06-21T04:00:00.000Z',
      results: [
        {
          templateId: 'tpl-primary',
          templateName: 'NPM Dependency CVE Hunt',
          seedFile: 'npm-dependency-cve-hunt.json',
          category: 'cve-research',
          components: ['sentris.osv.query'],
          requiredSecrets: [],
          runtimeInputs: [{ id: 'packageName' }],
          classification: 'live-run',
          createOk: true,
          runAttempted: true,
          terminalStatus: 'COMPLETED',
          artifactsCount: 1,
          recommendation: 'keep',
          rationale: 'Live execution completed and produced at least one artifact.',
        },
        {
          templateId: 'tpl-duplicate',
          templateName: 'npm dependency cve hunt',
          seedFile: 'npm-dependency-cve-hunt-copy.json',
          category: 'cve-research',
          components: ['sentris.osv.query'],
          requiredSecrets: [],
          runtimeInputs: [{ id: 'packageName' }],
          classification: 'live-run',
          createOk: true,
          runAttempted: true,
          terminalStatus: 'COMPLETED',
          artifactsCount: 1,
          recommendation: 'keep',
          rationale: 'Live execution completed and produced at least one artifact.',
        },
        {
          templateId: 'tpl-static',
          templateName: 'Static Demo Template',
          seedFile: 'static-demo-template.json',
          category: 'demo',
          components: ['core.logic.script'],
          requiredSecrets: [],
          runtimeInputs: [],
          classification: 'static',
          createOk: true,
          runAttempted: false,
          artifactsCount: 0,
          recommendation: 'review',
          rationale: 'Static demonstration workflow.',
        },
      ],
    });

    expect(markdown).toContain('## Catalog Quality');
    expect(markdown).toContain(
      '- Duplicate name: npm-dependency-cve-hunt.json, npm-dependency-cve-hunt-copy.json',
    );
    expect(markdown).toContain(
      '- Low-value/static candidate: static-demo-template.json has no runtime inputs or required secrets.',
    );
  });

  it('returns actionable catalog quality failures for audit exit handling', () => {
    const failures = getTemplateCatalogQualityFailures([
      {
        templateId: 'tpl-primary',
        templateName: 'NPM Dependency CVE Hunt',
        seedFile: 'npm-dependency-cve-hunt.json',
        category: 'cve-research',
        components: ['sentris.osv.query'],
        requiredSecrets: [],
        runtimeInputs: [{ id: 'packageName' }],
        classification: 'live-run',
        createOk: true,
        runAttempted: true,
        terminalStatus: 'COMPLETED',
        artifactsCount: 1,
        recommendation: 'keep',
        rationale: 'Live execution completed and produced at least one artifact.',
      },
      {
        templateId: 'tpl-duplicate',
        templateName: 'npm dependency cve hunt',
        seedFile: 'npm-dependency-cve-hunt-copy.json',
        category: 'cve-research',
        components: ['sentris.osv.query'],
        requiredSecrets: [],
        runtimeInputs: [{ id: 'packageName' }],
        classification: 'live-run',
        createOk: true,
        runAttempted: true,
        terminalStatus: 'COMPLETED',
        artifactsCount: 1,
        recommendation: 'keep',
        rationale: 'Live execution completed and produced at least one artifact.',
      },
      {
        templateId: 'tpl-static',
        templateName: 'Static Demo Template',
        seedFile: 'static-demo-template.json',
        category: 'demo',
        components: ['core.logic.script'],
        requiredSecrets: [],
        runtimeInputs: [],
        classification: 'create-only',
        createOk: true,
        runAttempted: false,
        artifactsCount: 0,
        recommendation: 'review',
        rationale: 'Static demonstration workflow.',
      },
    ]);

    expect(failures).toEqual([
      'Duplicate template name: npm-dependency-cve-hunt.json, npm-dependency-cve-hunt-copy.json',
      'Low-value/static template: static-demo-template.json has no runtime inputs or required secrets.',
    ]);
  });

  it('renders catalog quality as a concise ledger-check report', () => {
    const report = renderTemplateCatalogQualityCheck([
      {
        templateId: 'tpl-primary',
        templateName: 'NPM Dependency CVE Hunt',
        seedFile: 'npm-dependency-cve-hunt.json',
        category: 'cve-research',
        components: ['sentris.osv.query'],
        requiredSecrets: [],
        runtimeInputs: [{ id: 'packageName' }],
        classification: 'live-run',
        createOk: true,
        runAttempted: true,
        terminalStatus: 'COMPLETED',
        artifactsCount: 1,
        recommendation: 'keep',
        rationale: 'Live execution completed and produced at least one artifact.',
      },
      {
        templateId: 'tpl-duplicate',
        templateName: 'npm dependency cve hunt',
        seedFile: 'npm-dependency-cve-hunt-copy.json',
        category: 'cve-research',
        components: ['sentris.osv.query'],
        requiredSecrets: [],
        runtimeInputs: [{ id: 'packageName' }],
        classification: 'live-run',
        createOk: true,
        runAttempted: true,
        terminalStatus: 'COMPLETED',
        artifactsCount: 1,
        recommendation: 'keep',
        rationale: 'Live execution completed and produced at least one artifact.',
      },
      {
        templateId: 'tpl-static',
        templateName: 'Static Demo Template',
        seedFile: 'static-demo-template.json',
        category: 'demo',
        components: ['core.logic.script'],
        requiredSecrets: [],
        runtimeInputs: [],
        classification: 'create-only',
        createOk: true,
        runAttempted: false,
        artifactsCount: 0,
        recommendation: 'review',
        rationale: 'Static demonstration workflow.',
      },
    ]);

    expect(report).toContain('# Template Catalog Quality Check');
    expect(report).toContain('Duplicate names: 1');
    expect(report).toContain('Low-value/static candidates: 1');
    expect(report).toContain('## Catalog Quality Failures');
    expect(report).toContain(
      '- Duplicate template name: npm-dependency-cve-hunt.json, npm-dependency-cve-hunt-copy.json',
    );
    expect(report).toContain(
      '- Low-value/static template: static-demo-template.json has no runtime inputs or required secrets.',
    );
  });
});
