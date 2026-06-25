import { createHash } from 'node:crypto';
import { describe, expect, it } from 'bun:test';
import {
  SECURITY_COMPONENT_IDS,
  createSecurityComponentDockerBuildPlan,
  createSecurityComponentFingerprint,
  materializeSecurityComponentAuditFixture,
  parseSecurityComponentAuditCliOptions,
  pruneSecurityComponentLedger,
  renderSecurityComponentLedgerFreshness,
  shouldSkipSecurityComponentLiveAudit,
  summarizeSecurityComponentLedgerFreshness,
  SECURITY_COMPONENT_LIVE_FIXTURES,
} from '../security-component-audit-utils';

function createLegacySecurityComponentFingerprint(
  componentId: string,
  fixture: {
    inputs: Record<string, unknown>;
    params: Record<string, unknown>;
  },
): string {
  return createHash('sha256')
    .update(JSON.stringify({ componentId, inputs: fixture.inputs, params: fixture.params }))
    .digest('hex')
    .slice(0, 16);
}

describe('security-component-audit-utils', () => {
  it('parses repeated component filters', () => {
    const options = parseSecurityComponentAuditCliOptions([
      '--filter',
      'sentris.subfinder.run',
      '--filter',
      'sentris.httpx.scan',
    ]);

    expect([...options.componentIds]).toEqual(['sentris.subfinder.run', 'sentris.httpx.scan']);
  });

  it('rejects unknown component filters even when another filter is valid', () => {
    expect(() =>
      parseSecurityComponentAuditCliOptions([
        '--filter',
        'sentris.httpx.scan',
        '--filter',
        'sentris.not-a-component',
      ]),
    ).toThrow('Unknown security component filter: sentris.not-a-component');
  });

  it('rejects a filter flag without a component id', () => {
    expect(() => parseSecurityComponentAuditCliOptions(['--filter'])).toThrow(
      '--filter requires a component id',
    );
  });

  it('rejects unknown audit CLI options', () => {
    expect(() => parseSecurityComponentAuditCliOptions(['--dry-run'])).toThrow(
      'Unknown security component audit option: --dry-run',
    );
  });

  it('defines fixtures for every security component id', () => {
    for (const componentId of SECURITY_COMPONENT_IDS) {
      expect(SECURITY_COMPONENT_LIVE_FIXTURES[componentId]).toBeDefined();
    }
  });

  it('creates stable fingerprints for fixtures', () => {
    const fixture = SECURITY_COMPONENT_LIVE_FIXTURES['sentris.subfinder.run'];
    const first = createSecurityComponentFingerprint('sentris.subfinder.run', fixture);
    const second = createSecurityComponentFingerprint('sentris.subfinder.run', fixture);
    expect(first).toBe(second);
    expect(first).toHaveLength(16);
  });

  it('keeps fingerprints stable when equivalent fixture object keys are reordered', () => {
    const first = createSecurityComponentFingerprint('sentris.httpx.scan', {
      tier: 'A',
      inputs: {
        targets: ['https://scanme.nmap.org'],
        headers: { Accept: 'application/json', 'User-Agent': 'sentris-audit' },
      },
      params: { ports: '443', timeout: 30 },
    });
    const second = createSecurityComponentFingerprint('sentris.httpx.scan', {
      params: { timeout: 30, ports: '443' },
      inputs: {
        headers: { 'User-Agent': 'sentris-audit', Accept: 'application/json' },
        targets: ['https://scanme.nmap.org'],
      },
      tier: 'A',
    });

    expect(first).toBe(second);
  });

  it('materializes environment values into fixture inputs without mutating the fixture', () => {
    const fixture = {
      tier: 'C' as const,
      inputs: {
        apiKey: 'placeholder',
        credentials: {
          accessKeyId: 'placeholder-access',
        },
      },
      params: {
        databaseUrl: 'placeholder-db',
      },
      envInputOverrides: {
        apiKey: 'TEST_API_KEY',
        'credentials.accessKeyId': 'TEST_ACCESS_KEY_ID',
      },
      envParamOverrides: {
        databaseUrl: 'TEST_DATABASE_URL',
      },
    };

    const materialized = materializeSecurityComponentAuditFixture(fixture, {
      TEST_API_KEY: 'real-api-key',
      TEST_ACCESS_KEY_ID: 'real-access-key',
      TEST_DATABASE_URL: 'postgres://real-db',
    });

    expect(materialized.inputs).toEqual({
      apiKey: 'real-api-key',
      credentials: {
        accessKeyId: 'real-access-key',
      },
    });
    expect(materialized.params).toEqual({ databaseUrl: 'postgres://real-db' });
    expect(fixture.inputs.apiKey).toBe('placeholder');
    expect(fixture.params.databaseUrl).toBe('placeholder-db');
  });

  it('wires Supabase scanner live fixture secrets into scanner inputs', () => {
    const fixture = SECURITY_COMPONENT_LIVE_FIXTURES['sentris.supabase.scanner'];
    const materialized = materializeSecurityComponentAuditFixture(fixture, {
      SUPABASE_DATABASE_URL:
        'postgres://postgres:password@db.abcdefghijklmnopqrst.supabase.co:5432/postgres',
      SUPABASE_SCANNER_TARGET: 'https://abcdefghijklmnopqrst.supabase.co',
    });

    expect(fixture.requiresSecrets).toContain('SUPABASE_DATABASE_URL');
    expect(materialized.inputs).toMatchObject({
      supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co',
      databaseConnectionString:
        'postgres://postgres:password@db.abcdefghijklmnopqrst.supabase.co:5432/postgres',
    });
    expect(fixture.inputs).not.toHaveProperty('databaseConnectionString');
  });

  it('plans a local Docker image build only when a fixture image is missing', () => {
    const fixture = SECURITY_COMPONENT_LIVE_FIXTURES['sentris.supabase.scanner'];

    expect(createSecurityComponentDockerBuildPlan(fixture, () => true)).toBeUndefined();
    expect(createSecurityComponentDockerBuildPlan(fixture, () => false)).toEqual({
      image: 'ghcr.io/zebbern/supabase-scanner:latest',
      context: 'docker/supabase-scanner',
      args: ['build', '-t', 'ghcr.io/zebbern/supabase-scanner:latest', 'docker/supabase-scanner'],
    });
  });

  it('changes fingerprints when the component contract changes', () => {
    const fixture = SECURITY_COMPONENT_LIVE_FIXTURES['sentris.repository.files.extract'];
    const baseContract = {
      outputs: [{ id: 'sourceBundle', label: 'Source Bundle' }],
      parameters: [{ id: 'maxTotalBytes', label: 'Max Total Size' }],
    };
    const changedContract = {
      outputs: [
        { id: 'sourceBundle', label: 'Source Bundle' },
        { id: 'githubActionsBundle', label: 'GitHub Actions Bundle' },
      ],
      parameters: [{ id: 'maxTotalBytes', label: 'Max Total Size' }],
    };

    expect(
      createSecurityComponentFingerprint(
        'sentris.repository.files.extract',
        fixture,
        baseContract,
      ),
    ).not.toBe(
      createSecurityComponentFingerprint(
        'sentris.repository.files.extract',
        fixture,
        changedContract,
      ),
    );
  });

  it('fails freshness summary when non-credential component ledger entries are missing', () => {
    const summary = summarizeSecurityComponentLedgerFreshness(undefined, ['sentris.subfinder.run']);
    expect(summary.allCurrent).toBe(false);
    expect(summary.items[0]?.status).toBe('missing');
    expect(renderSecurityComponentLedgerFreshness(summary)).toContain('NEEDS ATTENTION');
  });

  it('prunes retired security component ledger entries', () => {
    const pruned = pruneSecurityComponentLedger(
      {
        version: 1,
        entries: {
          'sentris.httpx.scan': {
            componentId: 'sentris.httpx.scan',
            fingerprint: 'current-fingerprint',
            tier: 'A',
            status: 'passed',
            verifiedAt: '2026-06-22T16:49:11.338Z',
          },
          'retired.security.component': {
            componentId: 'retired.security.component',
            fingerprint: 'retired-fingerprint',
            tier: 'B',
            status: 'passed',
            verifiedAt: '2026-06-22T16:49:11.338Z',
          },
        },
      } as any,
      ['sentris.httpx.scan'],
    );

    expect(Object.keys(pruned?.entries ?? {})).toEqual(['sentris.httpx.scan']);
  });

  it('accepts legacy fixture fingerprints so deterministic hashing does not force re-audit', () => {
    const fixture = SECURITY_COMPONENT_LIVE_FIXTURES['sentris.nuclei.scan'];
    const legacyFingerprint = createLegacySecurityComponentFingerprint('sentris.nuclei.scan', fixture);
    expect(legacyFingerprint).not.toBe(
      createSecurityComponentFingerprint('sentris.nuclei.scan', fixture),
    );

    const summary = summarizeSecurityComponentLedgerFreshness(
      {
        version: 1,
        entries: {
          'sentris.nuclei.scan': {
            componentId: 'sentris.nuclei.scan',
            fingerprint: legacyFingerprint,
            tier: 'B',
            status: 'passed',
            verifiedAt: '2026-06-21T23:51:06.525Z',
          },
        },
      },
      ['sentris.nuclei.scan'],
    );

    expect(summary.allCurrent).toBe(true);
    expect(summary.items[0]?.status).toBe('current');
  });

  it('marks pre-contract fingerprints stale when component metadata is now available', () => {
    const fixture = SECURITY_COMPONENT_LIVE_FIXTURES['sentris.httpx.scan'];
    const preContractFingerprint = createSecurityComponentFingerprint('sentris.httpx.scan', fixture);
    const metadata = [
      {
        definition: {
          id: 'sentris.httpx.scan',
          label: 'HTTPX',
          runner: { kind: 'docker' },
        },
        inputs: [{ id: 'targets', label: 'Targets' }],
        outputs: [{ id: 'results', label: 'Results' }],
        parameters: [{ id: 'timeout', label: 'Timeout' }],
      },
    ];

    const summary = summarizeSecurityComponentLedgerFreshness(
      {
        version: 1,
        entries: {
          'sentris.httpx.scan': {
            componentId: 'sentris.httpx.scan',
            fingerprint: preContractFingerprint,
            tier: 'A',
            status: 'passed',
            verifiedAt: '2026-06-21T23:39:28.159Z',
          },
        },
      },
      ['sentris.httpx.scan'],
      metadata,
    );

    expect(summary.allCurrent).toBe(false);
    expect(summary.items[0]?.status).toBe('stale');
    expect(summary.items[0]?.rationale).toBe(
      'Fixture or component contract fingerprint changed',
    );
  });

  it('does not skip pre-contract ledger entries once contract metadata is available', () => {
    const fixture = SECURITY_COMPONENT_LIVE_FIXTURES['sentris.httpx.scan'];
    const preContractFingerprint = createSecurityComponentFingerprint('sentris.httpx.scan', fixture);
    const contract = {
      id: 'sentris.httpx.scan',
      outputs: [{ id: 'results', label: 'Results' }],
    };
    const contractAwareFingerprint = createSecurityComponentFingerprint(
      'sentris.httpx.scan',
      fixture,
      contract,
    );

    const skipped = shouldSkipSecurityComponentLiveAudit({
      ledger: {
        version: 1,
        entries: {
          'sentris.httpx.scan': {
            componentId: 'sentris.httpx.scan',
            fingerprint: preContractFingerprint,
            tier: 'A',
            status: 'passed',
            verifiedAt: '2026-06-21T23:39:28.159Z',
          },
        },
      },
      componentId: 'sentris.httpx.scan',
      fingerprint: contractAwareFingerprint,
      force: false,
      fixture,
      contract,
    });

    expect(skipped).toBeUndefined();
  });

  it('does not skip contract-aware entries after the contract changes', () => {
    const fixture = SECURITY_COMPONENT_LIVE_FIXTURES['sentris.repository.files.extract'];
    const oldContract = {
      outputs: [{ id: 'sourceBundle', label: 'Source Bundle' }],
    };
    const newContract = {
      outputs: [
        { id: 'sourceBundle', label: 'Source Bundle' },
        { id: 'githubActionsBundle', label: 'GitHub Actions Bundle' },
      ],
    };
    const oldFingerprint = createSecurityComponentFingerprint(
      'sentris.repository.files.extract',
      fixture,
      oldContract,
    );
    const newFingerprint = createSecurityComponentFingerprint(
      'sentris.repository.files.extract',
      fixture,
      newContract,
    );

    const skipped = shouldSkipSecurityComponentLiveAudit({
      ledger: {
        version: 1,
        entries: {
          'sentris.repository.files.extract': {
            componentId: 'sentris.repository.files.extract',
            fingerprint: oldFingerprint,
            tier: 'A',
            status: 'passed',
            verifiedAt: '2026-06-21T23:41:40.944Z',
          },
        },
      },
      componentId: 'sentris.repository.files.extract',
      fingerprint: newFingerprint,
      force: false,
      fixture,
      contract: newContract,
    });

    expect(skipped).toBeUndefined();
  });

  it('marks previous credential-gated skips stale once required secrets are available', () => {
    const fixture = SECURITY_COMPONENT_LIVE_FIXTURES['security.virustotal.lookup'];
    const fingerprint = createSecurityComponentFingerprint('security.virustotal.lookup', fixture);
    const originalValue = process.env.VIRUSTOTAL_API_KEY;
    process.env.VIRUSTOTAL_API_KEY = 'present';

    try {
      const summary = summarizeSecurityComponentLedgerFreshness(
        {
          version: 1,
          entries: {
            'security.virustotal.lookup': {
              componentId: 'security.virustotal.lookup',
              fingerprint,
              tier: 'C',
              status: 'skipped',
              error: 'Requires VirusTotal API key',
              verifiedAt: '2026-06-21T23:51:06.525Z',
            },
          },
        },
        ['security.virustotal.lookup'],
      );

      expect(summary.allCurrent).toBe(false);
      expect(summary.items[0]?.status).toBe('stale');
      expect(summary.items[0]?.rationale).toBe(
        'Required secrets are now available; previous skipped audit is no longer sufficient.',
      );
    } finally {
      if (originalValue === undefined) {
        delete process.env.VIRUSTOTAL_API_KEY;
      } else {
        process.env.VIRUSTOTAL_API_KEY = originalValue;
      }
    }
  });

  it('keeps a matching credential-gated pass current when secrets are not currently loaded', () => {
    const fixture = SECURITY_COMPONENT_LIVE_FIXTURES['security.virustotal.lookup'];
    const fingerprint = createSecurityComponentFingerprint('security.virustotal.lookup', fixture);
    const originalValue = process.env.VIRUSTOTAL_API_KEY;
    delete process.env.VIRUSTOTAL_API_KEY;

    try {
      const summary = summarizeSecurityComponentLedgerFreshness(
        {
          version: 1,
          entries: {
            'security.virustotal.lookup': {
              componentId: 'security.virustotal.lookup',
              fingerprint,
              tier: 'C',
              status: 'passed',
              verifiedAt: '2026-06-22T16:49:11.338Z',
            },
          },
        },
        ['security.virustotal.lookup'],
      );

      expect(summary.allCurrent).toBe(true);
      expect(summary.items[0]?.status).toBe('current');
      expect(summary.items[0]?.rationale).toContain('required secrets are not currently loaded');
    } finally {
      if (originalValue === undefined) {
        delete process.env.VIRUSTOTAL_API_KEY;
      } else {
        process.env.VIRUSTOTAL_API_KEY = originalValue;
      }
    }
  });

  it('keeps changed credential-gated skips skipped while required secrets are missing', () => {
    const fixture = SECURITY_COMPONENT_LIVE_FIXTURES['security.virustotal.lookup'];
    const originalValue = process.env.VIRUSTOTAL_API_KEY;
    delete process.env.VIRUSTOTAL_API_KEY;

    try {
      const summary = summarizeSecurityComponentLedgerFreshness(
        {
          version: 1,
          entries: {
            'security.virustotal.lookup': {
              componentId: 'security.virustotal.lookup',
              fingerprint: 'old-fingerprint',
              tier: 'C',
              status: 'skipped',
              error: 'Requires VirusTotal API key',
              verifiedAt: '2026-06-22T06:21:33.257Z',
            },
          },
        },
        ['security.virustotal.lookup'],
      );

      expect(fixture.requiresSecrets).toContain('VIRUSTOTAL_API_KEY');
      expect(summary.allCurrent).toBe(true);
      expect(summary.items[0]?.status).toBe('skipped');
      expect(summary.items[0]?.rationale).toBe('Requires VirusTotal API key');
    } finally {
      if (originalValue === undefined) {
        delete process.env.VIRUSTOTAL_API_KEY;
      } else {
        process.env.VIRUSTOTAL_API_KEY = originalValue;
      }
    }
  });

  it('downgrades changed credential-gated failures to skipped while required secrets are missing', () => {
    const fixture = SECURITY_COMPONENT_LIVE_FIXTURES['security.prowler.scan'];
    const originalAccessKey = process.env.AWS_ACCESS_KEY_ID;
    const originalSecretKey = process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;

    try {
      const summary = summarizeSecurityComponentLedgerFreshness(
        {
          version: 1,
          entries: {
            'security.prowler.scan': {
              componentId: 'security.prowler.scan',
              fingerprint: 'old-fingerprint',
              tier: 'C',
              status: 'failed',
              error: 'AWS scan requires credentials input.',
              verifiedAt: '2026-06-21T23:40:18.395Z',
            },
          },
        },
        ['security.prowler.scan'],
      );

      expect(fixture.requiresSecrets).toEqual(['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']);
      expect(summary.allCurrent).toBe(true);
      expect(summary.items[0]?.status).toBe('skipped');
      expect(summary.items[0]?.rationale).toBe('Requires AWS credentials');
    } finally {
      if (originalAccessKey === undefined) {
        delete process.env.AWS_ACCESS_KEY_ID;
      } else {
        process.env.AWS_ACCESS_KEY_ID = originalAccessKey;
      }
      if (originalSecretKey === undefined) {
        delete process.env.AWS_SECRET_ACCESS_KEY;
      } else {
        process.env.AWS_SECRET_ACCESS_KEY = originalSecretKey;
      }
    }
  });

  it('skips credential-gated fixtures with missing secrets even when force is requested', () => {
    const fixture = SECURITY_COMPONENT_LIVE_FIXTURES['security.virustotal.lookup'];
    const fingerprint = createSecurityComponentFingerprint('security.virustotal.lookup', fixture);
    const originalValue = process.env.VIRUSTOTAL_API_KEY;
    delete process.env.VIRUSTOTAL_API_KEY;

    try {
      const skipped = shouldSkipSecurityComponentLiveAudit({
        ledger: undefined,
        componentId: 'security.virustotal.lookup',
        fingerprint,
        force: true,
        fixture,
      });

      expect(skipped).toMatchObject({
        componentId: 'security.virustotal.lookup',
        fingerprint,
        tier: 'C',
        status: 'skipped',
        error: 'Requires VirusTotal API key',
      });
    } finally {
      if (originalValue === undefined) {
        delete process.env.VIRUSTOTAL_API_KEY;
      } else {
        process.env.VIRUSTOTAL_API_KEY = originalValue;
      }
    }
  });

  it('does not replace a matching credential-gated pass with a skip when secrets are missing', () => {
    const fixture = SECURITY_COMPONENT_LIVE_FIXTURES['security.virustotal.lookup'];
    const fingerprint = createSecurityComponentFingerprint('security.virustotal.lookup', fixture);
    const originalValue = process.env.VIRUSTOTAL_API_KEY;
    delete process.env.VIRUSTOTAL_API_KEY;

    try {
      const skipped = shouldSkipSecurityComponentLiveAudit({
        ledger: {
          version: 1,
          entries: {
            'security.virustotal.lookup': {
              componentId: 'security.virustotal.lookup',
              fingerprint,
              tier: 'C',
              status: 'passed',
              verifiedAt: '2026-06-22T16:49:11.338Z',
            },
          },
        },
        componentId: 'security.virustotal.lookup',
        fingerprint,
        force: true,
        fixture,
      });

      expect(skipped?.status).toBe('passed');
      expect(skipped?.verifiedAt).toBe('2026-06-22T16:49:11.338Z');
    } finally {
      if (originalValue === undefined) {
        delete process.env.VIRUSTOTAL_API_KEY;
      } else {
        process.env.VIRUSTOTAL_API_KEY = originalValue;
      }
    }
  });

  it('lets forced credential-gated fixtures run when all required secrets are present', () => {
    const fixture = SECURITY_COMPONENT_LIVE_FIXTURES['security.virustotal.lookup'];
    const fingerprint = createSecurityComponentFingerprint('security.virustotal.lookup', fixture);
    const originalValue = process.env.VIRUSTOTAL_API_KEY;
    process.env.VIRUSTOTAL_API_KEY = 'present';

    try {
      const skipped = shouldSkipSecurityComponentLiveAudit({
        ledger: undefined,
        componentId: 'security.virustotal.lookup',
        fingerprint,
        force: true,
        fixture,
      });

      expect(skipped).toBeUndefined();
    } finally {
      if (originalValue === undefined) {
        delete process.env.VIRUSTOTAL_API_KEY;
      } else {
        process.env.VIRUSTOTAL_API_KEY = originalValue;
      }
    }
  });

  it('skips missing required secrets even without a custom skip reason', () => {
    const fixture = {
      tier: 'C' as const,
      inputs: {},
      params: {},
      requiresSecrets: ['CUSTOM_REQUIRED_SECRET'],
    };
    const fingerprint = createSecurityComponentFingerprint('sentris.subfinder.run', fixture);
    const originalValue = process.env.CUSTOM_REQUIRED_SECRET;
    delete process.env.CUSTOM_REQUIRED_SECRET;

    try {
      const skipped = shouldSkipSecurityComponentLiveAudit({
        ledger: undefined,
        componentId: 'sentris.subfinder.run',
        fingerprint,
        force: true,
        fixture,
      });

      expect(skipped?.status).toBe('skipped');
      expect(skipped?.error).toBe('Missing required secrets: CUSTOM_REQUIRED_SECRET');
    } finally {
      if (originalValue === undefined) {
        delete process.env.CUSTOM_REQUIRED_SECRET;
      } else {
        process.env.CUSTOM_REQUIRED_SECRET = originalValue;
      }
    }
  });
});
