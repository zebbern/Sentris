import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createTemplateValidationFingerprint,
  createTemplateLiveAuditInputs,
  analyzeTemplateAuditRecommendation,
  getTemplateComponentValidationFingerprints,
  getTemplateAuditRequestRetryDelays,
  getTemplateAuditRuntimeRestartDecision,
  getTemplateAuditRuntimeStabilityDecision,
  getLiveRunAuditFailures,
  getNodeIoWarningSignals,
  getTemplateCoverageComponentIds,
  getTemplateCatalogQualityFailures,
  getTemplateOutputHandleCoverageFailures,
  getTemplateSeedCatalogCoverageFailures,
  renderTemplateCatalogQualityCheck,
  renderTemplateValidationLedgerFreshness,
  pruneTemplateValidationLedger,
  summarizeTemplateComponentCoverage,
  summarizeTemplateOutputHandleCoverage,
  summarizeTemplateValidationLedgerFreshness,
  renderTemplateAuditMarkdown,
  retryTransientAuditRequest,
  parseTemplateAuditCliOptions,
  resolveTemplateAuditApiBase,
  resolveTemplateAuditManagedSecretMappings,
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

  it('includes live fixtures for new CVE hunt templates', () => {
    const inputs = createTemplateLiveAuditInputs();

    expect(inputs['Tech Stack CVE Hunter']).toEqual({
      liveUrls: ['https://scanme.nmap.org/'],
      authorizationNotes: 'Live audit: public Nmap scanme target.',
    });
    expect(inputs['KEV / Fresh CVE Watch Brief']).toEqual({
      productKeyword: 'nginx',
      lookbackDays: 365,
      researchNotes: 'Live audit fixture for keyword CVE watch.',
    });
    expect(inputs['Public Repo Full Code Security']).toMatchObject({
      repositoryUrl: 'https://github.com/OWASP/NodeGoat',
      includeDevDependencies: false,
    });
    expect(inputs['GitHub Actions Supply Chain Triage']).toEqual({
      repositoryUrl: 'https://github.com/OWASP/NodeGoat',
      ref: '',
      authorizationNotes:
        'Live audit fixture: public repository with GitHub Actions workflows and non-destructive CI/CD supply-chain review.',
    });
    expect(inputs['Claude Code Bug Bounty Evidence Analyst']).toMatchObject({
      evidenceNotes: expect.stringContaining('lodash@4.17.20'),
      authorizedTargets: ['https://scanme.nmap.org', 'https://example.com'],
    });
    expect(inputs['Attack Surface Recon Analytics']).toEqual({
      domains: ['scanme.nmap.org'],
      authorizationNotes: 'Live audit fixture: bounded Nmap scanme target.',
    });
    expect(inputs['Exposure to CVE Brief']).toEqual({
      targets: ['scanme.nmap.org'],
      deploymentNotes: 'Live audit fixture: bounded service discovery target.',
      authorizationNotes: 'Live audit fixture.',
    });
    expect(inputs['WAF Edge Recon Triage']).toEqual({
      liveUrls: ['https://scanme.nmap.org/'],
      authorizationNotes: 'Live audit fixture: bounded WAF recon target.',
    });
    expect(inputs['YARA IOC Payload Triage']).toEqual({
      targetLabel: 'sentris-yara-live-fixture.txt',
      targetContent: 'benign fixture containing sentris-ioc-fixture for YARA validation',
      yaraRules: 'rule SentrisFixtureIOC { strings: $a = "sentris-ioc-fixture" condition: $a }',
      authorizationNotes: 'Live audit fixture: benign payload for local YARA validation.',
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

  it('maps template audit secret names to existing managed secret aliases', () => {
    const resolved = resolveTemplateAuditManagedSecretMappings(
      ['DISCORD_WEBHOOK_URL', 'MISSING_SECRET'],
      ['webhook_discord'],
    );

    expect(resolved).toEqual({
      secretMappings: {
        DISCORD_WEBHOOK_URL: 'webhook_discord',
      },
      providedSecretNames: ['DISCORD_WEBHOOK_URL'],
      missingSecretNames: ['MISSING_SECRET'],
    });
  });

  it('keeps explicit audit secret mappings ahead of managed secret aliases', () => {
    const base = resolveTemplateAuditSecretMappings(['DISCORD_WEBHOOK_URL'], {
      TEMPLATE_AUDIT_SECRET_MAPPINGS: JSON.stringify({
        DISCORD_WEBHOOK_URL: 'explicit-discord-secret',
      }),
    });
    const resolved = resolveTemplateAuditManagedSecretMappings(
      ['DISCORD_WEBHOOK_URL'],
      ['webhook_discord'],
      base,
    );

    expect(resolved.secretMappings.DISCORD_WEBHOOK_URL).toBe('explicit-discord-secret');
    expect(resolved.missingSecretNames).toEqual([]);
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

  it('rejects a targeted audit name flag without a template name', () => {
    expect(() => parseTemplateAuditCliOptions(['--name'])).toThrow(
      '--name requires a template name',
    );
  });

  it('rejects an empty targeted audit name assignment', () => {
    expect(() => parseTemplateAuditCliOptions(['--name='])).toThrow(
      '--name requires a template name',
    );
  });

  it('rejects an org flag without an organization id', () => {
    expect(() => parseTemplateAuditCliOptions(['--org-id', '--ledger-check'])).toThrow(
      '--org-id requires an organization id',
    );
  });

  it('rejects unknown template audit CLI options', () => {
    expect(() => parseTemplateAuditCliOptions(['--dry-run'])).toThrow(
      'Unknown template audit option: --dry-run',
    );
  });

  it('uses a longer retry budget for health gates without retrying mutations', () => {
    expect(getTemplateAuditRequestRetryDelays({ method: 'GET', path: '/health' })).toEqual([
      250,
      1000,
      3000,
      5000,
      10000,
      15000,
      30000,
    ]);
    expect(getTemplateAuditRequestRetryDelays({ method: 'GET', path: '/health/ready' })).toEqual([
      250,
      1000,
      3000,
      5000,
      10000,
      15000,
      30000,
    ]);
    expect(getTemplateAuditRequestRetryDelays({ method: 'GET', path: '/templates' })).toEqual([
      250,
      1000,
      3000,
    ]);
    expect(
      getTemplateAuditRequestRetryDelays({
        method: 'GET',
        path: '/workflows/runs/sentris-run-1/status',
      }),
    ).toEqual([1500, 3000, 5000, 10000, 15000, 30000]);
    expect(
      getTemplateAuditRequestRetryDelays({ method: 'POST', path: '/templates/template-1/use' }),
    ).toEqual([]);
  });

  it('treats failed live runs as retryable when the dev runtime restarted mid-run', () => {
    const decision = getTemplateAuditRuntimeRestartDecision({
      result: {
        templateId: 'tpl-web-logic',
        templateName: 'Web Logic CVE Candidate Hunt',
        seedFile: 'web-logic-cve-candidate-hunt.json',
        category: 'cve-research',
        components: ['sentris.nuclei.scan'],
        requiredSecrets: [],
        runtimeInputs: [{ id: 'liveUrls' }],
        classification: 'live-run',
        createOk: true,
        runAttempted: true,
        terminalStatus: 'FAILED',
        artifactsCount: 0,
        recommendation: 'fix',
        rationale: 'Live execution ended with status FAILED.',
      },
      before: {
        available: true,
        processes: [
          {
            name: 'sentris-worker-0',
            pid: 100,
            restartCount: 2,
            status: 'online',
          },
        ],
      },
      after: {
        available: true,
        processes: [
          {
            name: 'sentris-worker-0',
            pid: 200,
            restartCount: 3,
            status: 'online',
          },
        ],
      },
    });

    expect(decision.retryable).toBe(true);
    expect(decision.rationale).toContain('sentris-worker-0 restarted during the audit run');
    expect(decision.restarts).toEqual([
      {
        name: 'sentris-worker-0',
        beforePid: 100,
        afterPid: 200,
        beforeRestartCount: 2,
        afterRestartCount: 3,
        beforeStatus: 'online',
        afterStatus: 'online',
      },
    ]);
  });

  it('does not retry successful live runs just because the dev runtime restarted later', () => {
    const decision = getTemplateAuditRuntimeRestartDecision({
      result: {
        templateId: 'tpl-web-logic',
        templateName: 'Web Logic CVE Candidate Hunt',
        seedFile: 'web-logic-cve-candidate-hunt.json',
        category: 'cve-research',
        components: ['sentris.nuclei.scan'],
        requiredSecrets: [],
        runtimeInputs: [{ id: 'liveUrls' }],
        classification: 'live-run',
        createOk: true,
        runAttempted: true,
        terminalStatus: 'COMPLETED',
        artifactsCount: 1,
        recommendation: 'keep',
        rationale: 'Live execution completed and produced at least one artifact.',
      },
      before: {
        available: true,
        processes: [{ name: 'sentris-worker-0', pid: 100, restartCount: 2 }],
      },
      after: {
        available: true,
        processes: [{ name: 'sentris-worker-0', pid: 200, restartCount: 3 }],
      },
    });

    expect(decision.retryable).toBe(false);
    expect(decision.restarts).toHaveLength(1);
  });

  it('treats runtime process changes as unstable before mutation audit requests', () => {
    const decision = getTemplateAuditRuntimeStabilityDecision({
      before: {
        available: true,
        processes: [
          { name: 'sentris-backend-0', pid: 100, restartCount: 2, status: 'online' },
          { name: 'sentris-worker-0', pid: 300, restartCount: 4, status: 'online' },
        ],
      },
      after: {
        available: true,
        processes: [
          { name: 'sentris-backend-0', pid: 200, restartCount: 3, status: 'online' },
          { name: 'sentris-worker-0', pid: 300, restartCount: 4, status: 'online' },
        ],
      },
    });

    expect(decision.stable).toBe(false);
    expect(decision.restarts).toEqual([
      {
        name: 'sentris-backend-0',
        beforePid: 100,
        afterPid: 200,
        beforeRestartCount: 2,
        afterRestartCount: 3,
        beforeStatus: 'online',
        afterStatus: 'online',
      },
    ]);
    expect(decision.rationale).toContain('sentris-backend-0 changed during the stability window');
  });

  it('treats non-online runtime processes as unstable before mutation audit requests', () => {
    const decision = getTemplateAuditRuntimeStabilityDecision({
      before: {
        available: true,
        processes: [
          { name: 'sentris-backend-0', pid: 100, restartCount: 2, status: 'online' },
          { name: 'sentris-worker-0', pid: null, restartCount: null, status: 'missing' },
        ],
      },
      after: {
        available: true,
        processes: [
          { name: 'sentris-backend-0', pid: 100, restartCount: 2, status: 'online' },
          { name: 'sentris-worker-0', pid: null, restartCount: null, status: 'missing' },
        ],
      },
    });

    expect(decision.stable).toBe(false);
    expect(decision.unhealthyProcesses).toEqual([
      { name: 'sentris-worker-0', pid: null, restartCount: null, status: 'missing' },
    ]);
    expect(decision.rationale).toContain('sentris-worker-0 is missing');
  });

  it('does not block mutation audit requests when runtime snapshots are unavailable', () => {
    expect(
      getTemplateAuditRuntimeStabilityDecision({
        before: null,
        after: {
          available: false,
          processes: [],
          unavailableReason: 'pm2 unavailable',
        },
      }),
    ).toEqual({
      stable: true,
      restarts: [],
      unhealthyProcesses: [],
    });
  });

  it('resolves the live audit API base from explicit env or active local instance', () => {
    const root = mkdtempSync(join(tmpdir(), 'sentris-template-audit-api-base-'));
    try {
      writeFileSync(join(root, '.sentris-instance'), '4\n');

      expect(
        resolveTemplateAuditApiBase({
          env: { SENTRIS_API_BASE_URL: 'http://127.0.0.1:9999/api/v1' },
          repoRoot: root,
        }),
      ).toEqual({
        apiBase: 'http://127.0.0.1:9999/api/v1',
        source: 'env:SENTRIS_API_BASE_URL',
      });
      expect(
        resolveTemplateAuditApiBase({
          env: { API_BASE: 'http://127.0.0.1:8888/api/v1' },
          repoRoot: root,
        }),
      ).toEqual({
        apiBase: 'http://127.0.0.1:8888/api/v1',
        source: 'env:API_BASE',
      });
      expect(
        resolveTemplateAuditApiBase({
          env: {},
          repoRoot: root,
        }),
      ).toEqual({
        apiBase: 'http://127.0.0.1:3611/api/v1',
        source: 'file:.sentris-instance',
      });
      expect(
        resolveTemplateAuditApiBase({
          env: { SENTRIS_INSTANCE: '2' },
          repoRoot: root,
        }),
      ).toEqual({
        apiBase: 'http://127.0.0.1:3411/api/v1',
        source: 'env:SENTRIS_INSTANCE',
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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

  it('includes affiliated component validation fingerprints in template cache keys', () => {
    const template = {
      graph: {
        nodes: [
          { id: 'trigger_1', type: 'core.workflow.entrypoint' },
          { id: 'extract_repo_files', type: 'sentris.repository.files.extract' },
          { id: 'artifact_report', type: 'core.artifact.writer' },
        ],
        edges: [],
      },
    };
    const baseTemplate = {
      template: {
        name: 'Public Repo Code & IaC Risk Triage',
        graph: template.graph,
      },
      liveInputs: { repositoryUrl: 'https://github.com/OWASP/NodeGoat' },
    };
    const oldComponentLedger = {
      version: 1 as const,
      entries: {
        'sentris.repository.files.extract': {
          componentId: 'sentris.repository.files.extract' as const,
          fingerprint: 'old-contract',
          tier: 'A' as const,
          status: 'passed' as const,
          verifiedAt: '2026-06-21T00:00:00.000Z',
        },
      },
    };
    const newComponentLedger = {
      version: 1 as const,
      entries: {
        'sentris.repository.files.extract': {
          componentId: 'sentris.repository.files.extract' as const,
          fingerprint: 'new-contract',
          tier: 'A' as const,
          status: 'passed' as const,
          verifiedAt: '2026-06-22T00:00:00.000Z',
        },
      },
    };

    const oldFingerprint = createTemplateValidationFingerprint({
      ...baseTemplate,
      componentValidationFingerprints: getTemplateComponentValidationFingerprints(
        template,
        oldComponentLedger,
      ),
    });
    const newFingerprint = createTemplateValidationFingerprint({
      ...baseTemplate,
      componentValidationFingerprints: getTemplateComponentValidationFingerprints(
        template,
        newComponentLedger,
      ),
    });

    expect(oldFingerprint).not.toBe(newFingerprint);
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

  it('skips legacy template fingerprints when component validations predate the template run', () => {
    const ledger = upsertTemplateValidationLedger(
      undefined,
      {
        templateName: 'Bug Bounty Recon Triage',
        seedFile: 'bug-bounty-recon-triage.json',
        fingerprint: 'sha256:legacy',
        terminalStatus: 'COMPLETED',
        recommendation: 'keep',
        rationale: 'Live execution completed and produced at least one artifact.',
        artifactsCount: 1,
      },
      '2026-06-22T05:00:00.000Z',
    );

    const skip = shouldSkipTemplateValidation({
      ledger,
      templateName: 'Bug Bounty Recon Triage',
      classification: 'live-run',
      fingerprint: 'sha256:component-aware',
      legacyFingerprint: 'sha256:legacy',
      componentValidationVerifiedAt: {
        'sentris.subfinder.run': '2026-06-22T04:00:00.000Z',
      },
      force: false,
    });

    expect(skip?.recommendation).toBe('keep');
    expect(skip?.terminalStatus).toBe('SKIPPED');
  });

  it('does not skip legacy template fingerprints after an affiliated component was revalidated', () => {
    const ledger = upsertTemplateValidationLedger(
      undefined,
      {
        templateName: 'Bug Bounty Recon Triage',
        seedFile: 'bug-bounty-recon-triage.json',
        fingerprint: 'sha256:legacy',
        terminalStatus: 'COMPLETED',
        recommendation: 'keep',
        rationale: 'Live execution completed and produced at least one artifact.',
        artifactsCount: 1,
      },
      '2026-06-22T05:00:00.000Z',
    );

    expect(
      shouldSkipTemplateValidation({
        ledger,
        templateName: 'Bug Bounty Recon Triage',
        classification: 'live-run',
        fingerprint: 'sha256:component-aware',
        legacyFingerprint: 'sha256:legacy',
        componentValidationVerifiedAt: {
          'sentris.subfinder.run': '2026-06-22T06:00:00.000Z',
        },
        force: false,
      }),
    ).toBeNull();
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

  it('summarizes legacy fingerprints as current only while component validations are older', () => {
    const ledger = {
      version: 1 as const,
      entries: {
        LegacyCurrent: {
          templateName: 'LegacyCurrent',
          seedFile: 'legacy-current.json',
          fingerprint: 'sha256:legacy-current',
          terminalStatus: 'COMPLETED',
          recommendation: 'keep',
          rationale: 'Live execution completed.',
          artifactsCount: 1,
          verifiedAt: '2026-06-22T05:00:00.000Z',
        },
        LegacyStale: {
          templateName: 'LegacyStale',
          seedFile: 'legacy-stale.json',
          fingerprint: 'sha256:legacy-stale',
          terminalStatus: 'COMPLETED',
          recommendation: 'keep',
          rationale: 'Live execution completed.',
          artifactsCount: 1,
          verifiedAt: '2026-06-22T05:00:00.000Z',
        },
      },
    };

    const summary = summarizeTemplateValidationLedgerFreshness(ledger, [
      {
        templateName: 'LegacyCurrent',
        seedFile: 'legacy-current.json',
        fingerprint: 'sha256:component-aware-current',
        legacyFingerprint: 'sha256:legacy-current',
        componentValidationVerifiedAt: {
          'sentris.httpx.scan': '2026-06-22T04:30:00.000Z',
        },
        classification: 'live-run',
      },
      {
        templateName: 'LegacyStale',
        seedFile: 'legacy-stale.json',
        fingerprint: 'sha256:component-aware-stale',
        legacyFingerprint: 'sha256:legacy-stale',
        componentValidationVerifiedAt: {
          'sentris.httpx.scan': '2026-06-22T05:30:00.000Z',
        },
        classification: 'live-run',
      },
    ]);

    expect(summary.counts).toMatchObject({ current: 1, stale: 1 });
    expect(summary.items.map((item) => [item.templateName, item.status])).toEqual([
      ['LegacyCurrent', 'current'],
      ['LegacyStale', 'stale'],
    ]);
  });

  it('prunes validation ledger entries for retired templates', () => {
    const ledger = {
      version: 1 as const,
      entries: {
        Active: {
          templateName: 'Active',
          seedFile: 'active.json',
          fingerprint: 'sha256:active',
          terminalStatus: 'COMPLETED',
          recommendation: 'keep',
          rationale: 'Live execution completed.',
          artifactsCount: 1,
          verifiedAt: '2026-06-22T05:00:00.000Z',
        },
        Retired: {
          templateName: 'Retired',
          seedFile: 'retired.json',
          fingerprint: 'sha256:retired',
          terminalStatus: 'COMPLETED',
          recommendation: 'keep',
          rationale: 'Live execution completed.',
          artifactsCount: 1,
          verifiedAt: '2026-06-22T05:00:00.000Z',
        },
      },
    };

    const pruned = pruneTemplateValidationLedger(ledger, ['Active']);

    expect(Object.keys(pruned.entries)).toEqual(['Active']);
    expect(pruned.entries.Active).toEqual(ledger.entries.Active);
  });

  it('retries transient audit request failures with bounded backoff', async () => {
    const sleeps: number[] = [];
    let attempts = 0;

    const result = await retryTransientAuditRequest(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error('fetch failed: ECONNREFUSED');
        }
        return 'ok';
      },
      {
        delaysMs: [10, 50, 100],
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      },
    );

    expect(result).toBe('ok');
    expect(attempts).toBe(3);
    expect(sleeps).toEqual([10, 50]);
  });

  it('retries Bun refused-connection audit errors by error code', async () => {
    const sleeps: number[] = [];
    let attempts = 0;

    const result = await retryTransientAuditRequest(
      async () => {
        attempts += 1;
        if (attempts === 1) {
          throw Object.assign(
            new Error('Unable to connect. Is the computer able to access the url?'),
            {
              code: 'ConnectionRefused',
              path: 'http://127.0.0.1:3211/api/v1/health',
              errno: 0,
            },
          );
        }
        return 'healthy';
      },
      {
        delaysMs: [25, 100],
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      },
    );

    expect(result).toBe('healthy');
    expect(attempts).toBe(2);
    expect(sleeps).toEqual([25]);
  });

  it('retries transient HTTP audit responses without retrying client errors', async () => {
    let rateLimitAttempts = 0;
    const rateLimitResult = await retryTransientAuditRequest(
      async () => {
        rateLimitAttempts += 1;
        if (rateLimitAttempts === 1) {
          throw Object.assign(new Error('429 Too Many Requests'), { status: 429 });
        }
        return 'rate-limit-cleared';
      },
      {
        delaysMs: [5],
        sleep: async () => {},
      },
    );

    let clientErrorAttempts = 0;
    await expect(
      retryTransientAuditRequest(
        async () => {
          clientErrorAttempts += 1;
          throw Object.assign(new Error('400 Bad Request'), { status: 400 });
        },
        {
          delaysMs: [5],
          sleep: async () => {},
        },
      ),
    ).rejects.toThrow('400 Bad Request');

    expect(rateLimitResult).toBe('rate-limit-cleared');
    expect(rateLimitAttempts).toBe(2);
    expect(clientErrorAttempts).toBe(1);
  });

  it('honors Retry-After seconds for transient audit HTTP responses', async () => {
    const sleeps: number[] = [];
    let attempts = 0;

    const result = await retryTransientAuditRequest(
      async () => {
        attempts += 1;
        if (attempts === 1) {
          throw Object.assign(new Error('429 Too Many Requests'), {
            status: 429,
            retryAfter: '2',
          });
        }
        return 'rate-limit-cleared';
      },
      {
        delaysMs: [5],
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      },
    );

    expect(result).toBe('rate-limit-cleared');
    expect(sleeps).toEqual([2000]);
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

  it('keeps completed artifact runs when warnings are only nonblocking public source outages', () => {
    const recommendation = analyzeTemplateAuditRecommendation({
      result: {
        runAttempted: true,
        terminalStatus: 'COMPLETED',
        artifactsCount: 1,
        nodeIo: [
          {
            nodeRef: 'query_nvd',
            componentId: 'sentris.nvd.cve.query',
            status: 'completed',
            durationMs: 4400,
            errorMessage: null,
            inputKeys: ['cveIds'],
            outputKeys: ['warnings'],
            warnings: ['NVD CVE query unavailable: Service Unavailable'],
            inputsSpilled: false,
            inputsTruncated: false,
            outputsSpilled: false,
            outputsTruncated: false,
          },
        ],
      },
      runtimeInputState: 'present',
      runtimeInputs: [{ id: 'evidenceNotes', label: 'Evidence notes' }],
      requiredSecrets: [],
      missingSecretNames: [],
      components: ['sentris.nvd.cve.query', 'core.artifact.writer'],
      hasUnmappedSlackNode: false,
    });

    expect(recommendation).toEqual({
      recommendation: 'keep',
      rationale:
        'Live execution completed with artifact and only nonblocking public data source warnings: query_nvd: NVD CVE query unavailable: Service Unavailable',
    });
  });

  it('reviews completed artifact runs when warnings are not recognized as nonblocking source outages', () => {
    const recommendation = analyzeTemplateAuditRecommendation({
      result: {
        runAttempted: true,
        terminalStatus: 'COMPLETED',
        artifactsCount: 1,
        nodeIo: [
          {
            nodeRef: 'assemble_report',
            componentId: 'core.logic.script',
            status: 'completed',
            durationMs: 400,
            errorMessage: null,
            inputKeys: ['findings'],
            outputKeys: ['report'],
            warnings: ['Report is missing prioritized findings'],
            inputsSpilled: false,
            inputsTruncated: false,
            outputsSpilled: false,
            outputsTruncated: false,
          },
        ],
      },
      runtimeInputState: 'present',
      runtimeInputs: [{ id: 'evidenceNotes', label: 'Evidence notes' }],
      requiredSecrets: [],
      missingSecretNames: [],
      components: ['core.logic.script', 'core.artifact.writer'],
      hasUnmappedSlackNode: false,
    });

    expect(recommendation).toEqual({
      recommendation: 'review',
      rationale:
        'Live execution completed with artifact but emitted warnings: assemble_report: Report is missing prioritized findings',
    });
  });

  it('reports started live-run timeout errors before credential-gated rationale', () => {
    const recommendation = analyzeTemplateAuditRecommendation({
      result: {
        runAttempted: true,
        runStartError:
          'Run sentris-run-1 did not reach a terminal state in 420000ms; last status RUNNING\nworker retry details',
      },
      runtimeInputState: 'present',
      runtimeInputs: [{ id: 'projectLabel', label: 'Project label' }],
      requiredSecrets: ['SUPABASE_DATABASE_URL'],
      missingSecretNames: [],
      components: ['sentris.supabase.scanner'],
      hasUnmappedSlackNode: false,
    });

    expect(recommendation).toEqual({
      recommendation: 'fix',
      rationale:
        'Run sentris-run-1 did not reach a terminal state in 420000ms; last status RUNNING',
    });
  });

  it('reports started live-run status errors before credential-gated rationale', () => {
    const recommendation = analyzeTemplateAuditRecommendation({
      result: {
        runAttempted: true,
        terminalStatus: 'CANCELLED',
        statusError:
          'Run unexpectedly started for a credential-gated template; cancelled to avoid external side effects.\nextra trace',
      },
      runtimeInputState: 'present',
      runtimeInputs: [{ id: 'repositoryUrl', label: 'Repository URL' }],
      requiredSecrets: ['DISCORD_WEBHOOK_URL'],
      missingSecretNames: [],
      components: ['core.notification.discord'],
      hasUnmappedSlackNode: false,
    });

    expect(recommendation).toEqual({
      recommendation: 'fix',
      rationale:
        'Run unexpectedly started for a credential-gated template; cancelled to avoid external side effects.',
    });
  });

  it('flags completed live runs that produce no artifacts', () => {
    const recommendation = analyzeTemplateAuditRecommendation({
      result: {
        runAttempted: true,
        terminalStatus: 'COMPLETED',
        artifactsCount: 0,
      },
      runtimeInputState: 'present',
      runtimeInputs: [{ id: 'repositoryUrl', label: 'Repository URL' }],
      requiredSecrets: [],
      missingSecretNames: [],
      components: ['sentris.semgrep.run'],
      hasUnmappedSlackNode: false,
    });

    expect(recommendation).toEqual({
      recommendation: 'fix',
      rationale: 'Live execution completed but produced no artifacts.',
    });
  });

  it('keeps unapplied credential-gated templates as review items', () => {
    const recommendation = analyzeTemplateAuditRecommendation({
      result: { runAttempted: false },
      runtimeInputState: 'present',
      runtimeInputs: [{ id: 'liveUrls', label: 'Live URLs' }],
      requiredSecrets: ['DISCORD_WEBHOOK_URL'],
      missingSecretNames: ['DISCORD_WEBHOOK_URL'],
      components: ['core.notification.discord'],
      hasUnmappedSlackNode: false,
    });

    expect(recommendation).toEqual({
      recommendation: 'review',
      rationale:
        'Credential-gated template requires explicit audit secret mappings for: DISCORD_WEBHOOK_URL.',
    });
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
          templateId: 'tpl-functional-copy',
          templateName: 'Package Advisory Scanner',
          seedFile: 'package-advisory-scanner.json',
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
      '- Duplicate functionality: npm-dependency-cve-hunt.json, npm-dependency-cve-hunt-copy.json, package-advisory-scanner.json',
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
      {
        templateId: 'tpl-functional-copy',
        templateName: 'Package Advisory Scanner',
        seedFile: 'package-advisory-scanner.json',
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
    ]);

    expect(failures).toEqual([
      'Duplicate template name: npm-dependency-cve-hunt.json, npm-dependency-cve-hunt-copy.json',
      'Duplicate template functionality: npm-dependency-cve-hunt.json, npm-dependency-cve-hunt-copy.json, package-advisory-scanner.json',
      'Low-value/static template: static-demo-template.json has no runtime inputs or required secrets.',
    ]);
  });

  it('flags notification-only template variants as duplicate functionality', () => {
    const failures = getTemplateCatalogQualityFailures([
      {
        templateId: 'tpl-repo-security',
        templateName: 'Public Repo Full Code Security',
        seedFile: 'public-repo-full-code-security.json',
        category: 'bug-bounty',
        components: [
          'core.workflow.entrypoint',
          'sentris.repository.files.extract',
          'sentris.repository.manifest.extract',
          'sentris.trufflehog.scan',
          'sentris.semgrep.run',
          'sentris.osv.query',
          'core.logic.script',
          'core.artifact.writer',
          'core.analytics.sink',
        ],
        requiredSecrets: [],
        runtimeInputs: [
          { id: 'repositoryUrl', type: 'text' },
          { id: 'ref', type: 'text', required: false, defaultValue: '' },
        ],
        classification: 'live-run',
        createOk: true,
        runAttempted: true,
        terminalStatus: 'COMPLETED',
        artifactsCount: 1,
        recommendation: 'keep',
        rationale: 'Live execution completed and produced at least one artifact.',
      },
      {
        templateId: 'tpl-repo-security-discord',
        templateName: 'Public Repo Full Code Security → Discord',
        seedFile: 'public-repo-full-code-security-discord-report.json',
        category: 'bug-bounty',
        components: [
          'core.workflow.entrypoint',
          'sentris.repository.files.extract',
          'sentris.repository.manifest.extract',
          'sentris.trufflehog.scan',
          'sentris.semgrep.run',
          'sentris.osv.query',
          'core.logic.script',
          'core.artifact.writer',
          'core.analytics.sink',
          'core.notification.run-report-discord',
        ],
        requiredSecrets: ['DISCORD_WEBHOOK_URL'],
        runtimeInputs: [
          { id: 'repositoryUrl', type: 'text' },
          { id: 'ref', type: 'text', required: false, defaultValue: '' },
        ],
        classification: 'live-run',
        createOk: true,
        runAttempted: true,
        terminalStatus: 'COMPLETED',
        artifactsCount: 1,
        recommendation: 'keep',
        rationale: 'Live execution completed and produced at least one artifact.',
      },
    ]);

    expect(failures).toEqual([
      'Duplicate template functionality: public-repo-full-code-security.json, public-repo-full-code-security-discord-report.json',
    ]);
  });

  it('flags optional runtime inputs without safe defaults before live audit', () => {
    const failures = getTemplateCatalogQualityFailures([
      {
        templateId: 'tpl-runtime-defaults',
        templateName: 'Runtime Edge Case Template',
        seedFile: 'runtime-edge-case-template.json',
        category: 'bug-bounty',
        components: ['core.logic.script'],
        requiredSecrets: [],
        runtimeInputs: [
          { id: 'authorizationNotes', type: 'text', required: false },
          { id: 'knownSubdomains', type: 'array', required: false, defaultValue: '' },
          { id: 'includeDevDependencies', type: 'boolean', required: false, defaultValue: '' },
        ],
        classification: 'live-run',
        createOk: true,
        runAttempted: true,
        terminalStatus: 'COMPLETED',
        artifactsCount: 1,
        recommendation: 'keep',
        rationale: 'Live execution completed and produced at least one artifact.',
      },
    ]);

    expect(failures).toEqual([
      'Runtime input default issue: runtime-edge-case-template.json optional text input authorizationNotes must define defaultValue as a string.',
      'Runtime input default issue: runtime-edge-case-template.json optional array input knownSubdomains must define defaultValue as an array.',
      'Runtime input default issue: runtime-edge-case-template.json optional boolean input includeDevDependencies must define defaultValue as a boolean.',
    ]);
  });

  it('reports validated security components that have no template coverage', () => {
    const coverage = summarizeTemplateComponentCoverage(
      [
        {
          templateId: 'tpl-recon',
          templateName: 'Bug Bounty Recon Triage',
          seedFile: 'bug-bounty-recon-triage.json',
          category: 'bug-bounty',
          components: ['core.workflow.entrypoint', 'sentris.httpx.scan'],
          requiredSecrets: [],
          runtimeInputs: [{ id: 'targetUrls' }],
          classification: 'live-run',
          createOk: true,
          runAttempted: true,
          terminalStatus: 'COMPLETED',
          artifactsCount: 1,
          recommendation: 'keep',
          rationale: 'Live execution completed and produced at least one artifact.',
        },
      ],
      ['sentris.httpx.scan', 'sentris.wafw00f.run'],
    );

    expect(coverage.unusedComponents).toEqual(['sentris.wafw00f.run']);
    expect(coverage.componentTemplateCounts).toEqual({
      'sentris.httpx.scan': 1,
      'sentris.wafw00f.run': 0,
    });
  });

  it('reports required component output handles that are not wired by any live template', () => {
    const coverage = summarizeTemplateOutputHandleCoverage(
      [
        {
          templateId: 'tpl-repo-code',
          templateName: 'Public Repo Code & IaC Risk Triage',
          seedFile: 'public-repo-code-iac-risk-triage.json',
          category: 'bug-bounty',
          components: ['sentris.repository.files.extract', 'core.logic.script'],
          requiredSecrets: [],
          runtimeInputs: [{ id: 'repositoryUrl' }],
          classification: 'live-run',
          createOk: true,
          runAttempted: true,
          terminalStatus: 'COMPLETED',
          artifactsCount: 1,
          recommendation: 'keep',
          rationale: 'Live execution completed and produced at least one artifact.',
          nodeIo: [
            {
              nodeRef: 'extract_repo_files',
              componentId: 'sentris.repository.files.extract',
              status: 'completed',
              durationMs: 1000,
              errorMessage: null,
              inputKeys: ['repositoryUrl'],
              outputKeys: ['sourceBundle', 'summary'],
              warnings: [],
              inputsSpilled: false,
              inputsTruncated: false,
              outputsSpilled: false,
              outputsTruncated: false,
            },
          ],
        },
      ],
      [
        {
          componentId: 'sentris.repository.files.extract',
          outputHandle: 'githubActionsBundle',
          reason: 'GitHub Actions supply-chain templates need the workflow YAML bundle.',
        },
      ],
    );

    expect(coverage.outputHandleTemplateCounts).toEqual({
      'sentris.repository.files.extract:githubActionsBundle': 0,
    });
    expect(coverage.unusedOutputHandles).toEqual([
      {
        componentId: 'sentris.repository.files.extract',
        outputHandle: 'githubActionsBundle',
        reason: 'GitHub Actions supply-chain templates need the workflow YAML bundle.',
      },
    ]);
  });

  it('returns output-handle coverage failures for audit exit handling', () => {
    const failures = getTemplateOutputHandleCoverageFailures(
      [
        {
          templateId: 'tpl-repo-code',
          templateName: 'Public Repo Code & IaC Risk Triage',
          seedFile: 'public-repo-code-iac-risk-triage.json',
          category: 'bug-bounty',
          components: ['sentris.repository.files.extract'],
          requiredSecrets: [],
          runtimeInputs: [{ id: 'repositoryUrl' }],
          classification: 'live-run',
          createOk: true,
          runAttempted: true,
          terminalStatus: 'COMPLETED',
          artifactsCount: 1,
          recommendation: 'keep',
          rationale: 'Live execution completed and produced at least one artifact.',
          nodeIo: [
            {
              nodeRef: 'extract_repo_files',
              componentId: 'sentris.repository.files.extract',
              status: 'completed',
              durationMs: 1000,
              errorMessage: null,
              inputKeys: ['repositoryUrl'],
              outputKeys: ['sourceBundle'],
              warnings: [],
              inputsSpilled: false,
              inputsTruncated: false,
              outputsSpilled: false,
              outputsTruncated: false,
            },
          ],
        },
      ],
      [
        {
          componentId: 'sentris.repository.files.extract',
          outputHandle: 'githubActionsBundle',
          reason: 'GitHub Actions supply-chain templates need the workflow YAML bundle.',
        },
      ],
    );

    expect(failures).toEqual([
      'Output handle coverage gap: sentris.repository.files.extract.githubActionsBundle is not observed in any live-validated template. GitHub Actions supply-chain templates need the workflow YAML bundle.',
    ]);
  });

  it('excludes demo-only components from template coverage requirements', () => {
    expect(
      getTemplateCoverageComponentIds([
        'sentris.security.terminal-demo',
        'sentris.yara.run',
        'sentris.yara.run',
      ]),
    ).toEqual(['sentris.yara.run']);
  });

  it('renders catalog quality as a concise ledger-check report', () => {
    const report = renderTemplateCatalogQualityCheck(
      [
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
        {
          templateId: 'tpl-functional-copy',
          templateName: 'Package Advisory Scanner',
          seedFile: 'package-advisory-scanner.json',
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
      ],
      { componentCoverageIds: ['sentris.osv.query', 'sentris.wafw00f.run'] },
    );

    expect(report).toContain('# Template Catalog Quality Check');
    expect(report).toContain('Duplicate names: 1');
    expect(report).toContain('Duplicate functionality: 1');
    expect(report).toContain('Low-value/static candidates: 1');
    expect(report).toContain('Component coverage gaps: 1');
    expect(report).toContain(
      '- sentris.wafw00f.run: no live-validated template currently uses this component.',
    );
    expect(report).toContain('## Catalog Quality Failures');
    expect(report).toContain(
      '- Duplicate template name: npm-dependency-cve-hunt.json, npm-dependency-cve-hunt-copy.json',
    );
    expect(report).toContain(
      '- Duplicate template functionality: npm-dependency-cve-hunt.json, npm-dependency-cve-hunt-copy.json, package-advisory-scanner.json',
    );
    expect(report).toContain(
      '- Low-value/static template: static-demo-template.json has no runtime inputs or required secrets.',
    );
  });

  it('renders required output-handle coverage gaps in catalog quality reports', () => {
    const report = renderTemplateCatalogQualityCheck(
      [
        {
          templateId: 'tpl-repo-code',
          templateName: 'Public Repo Code & IaC Risk Triage',
          seedFile: 'public-repo-code-iac-risk-triage.json',
          category: 'bug-bounty',
          components: ['sentris.repository.files.extract'],
          requiredSecrets: [],
          runtimeInputs: [{ id: 'repositoryUrl' }],
          classification: 'live-run',
          createOk: true,
          runAttempted: true,
          terminalStatus: 'COMPLETED',
          artifactsCount: 1,
          recommendation: 'keep',
          rationale: 'Live execution completed and produced at least one artifact.',
          nodeIo: [
            {
              nodeRef: 'extract_repo_files',
              componentId: 'sentris.repository.files.extract',
              status: 'completed',
              durationMs: 1000,
              errorMessage: null,
              inputKeys: ['repositoryUrl'],
              outputKeys: ['sourceBundle'],
              warnings: [],
              inputsSpilled: false,
              inputsTruncated: false,
              outputsSpilled: false,
              outputsTruncated: false,
            },
          ],
        },
      ],
      {
        requiredOutputHandles: [
          {
            componentId: 'sentris.repository.files.extract',
            outputHandle: 'githubActionsBundle',
            reason: 'GitHub Actions supply-chain templates need the workflow YAML bundle.',
          },
        ],
      },
    );

    expect(report).toContain('Output handle coverage gaps: 1');
    expect(report).toContain('## Output Handle Coverage Gaps');
    expect(report).toContain(
      '- sentris.repository.files.extract.githubActionsBundle: GitHub Actions supply-chain templates need the workflow YAML bundle.',
    );
    expect(report).toContain(
      '- Output handle coverage gap: sentris.repository.files.extract.githubActionsBundle is not observed in any live-validated template. GitHub Actions supply-chain templates need the workflow YAML bundle.',
    );
  });

  it('flags seed templates that are missing from the API catalog', () => {
    const failures = getTemplateSeedCatalogCoverageFailures({
      apiTemplateNames: ['NPM Dependency CVE Hunt'],
      seedTemplates: [
        { name: 'NPM Dependency CVE Hunt', file: 'npm-dependency-cve-hunt.json' },
        {
          name: 'Supabase Project Exposure Triage',
          file: 'supabase-project-exposure-triage.json',
        },
      ],
    });

    expect(failures).toEqual([
      'Seed template missing from API catalog: supabase-project-exposure-triage.json (Supabase Project Exposure Triage). Run the seed step before validation.',
    ]);

    const report = renderTemplateCatalogQualityCheck(
      [
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
      ],
      {
        seedCatalogCoverageFailures: failures,
      },
    );

    expect(report).toContain('Seed/API catalog gaps: 1');
    expect(report).toContain(
      '- Seed template missing from API catalog: supabase-project-exposure-triage.json (Supabase Project Exposure Triage). Run the seed step before validation.',
    );
  });
});
