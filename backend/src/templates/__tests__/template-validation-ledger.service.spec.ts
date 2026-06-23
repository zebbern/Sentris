import { afterEach, describe, expect, it } from 'bun:test';
import {
  createTemplateLiveAuditInputs,
  createTemplateValidationFingerprint,
} from '@sentris/shared/template-validation-fingerprint';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { TemplateValidationLedgerService } from '../template-validation-ledger.service';

const previousLedgerPath = process.env.TEMPLATE_AUDIT_LEDGER_PATH;
const previousSeedDir = process.env.TEMPLATE_SEED_DIR;
const previousSecurityLedgerPath = process.env.SECURITY_COMPONENT_AUDIT_LEDGER_PATH;

function writeLedger(entries: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), 'sentris-template-ledger-test-'));
  const ledgerPath = join(dir, 'template-live-audit-ledger.json');
  writeFileSync(ledgerPath, `${JSON.stringify({ version: 1, entries }, null, 2)}\n`);
  process.env.TEMPLATE_AUDIT_LEDGER_PATH = ledgerPath;
  return dir;
}

function writeSeedTemplate(fileName: string, template: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), 'sentris-template-seed-test-'));
  writeFileSync(join(dir, fileName), `${JSON.stringify(template, null, 2)}\n`);
  process.env.TEMPLATE_SEED_DIR = dir;
  return dir;
}

function writeSecurityComponentLedger(entries: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), 'sentris-security-component-ledger-test-'));
  const ledgerPath = join(dir, 'security-component-audit-ledger.json');
  writeFileSync(ledgerPath, `${JSON.stringify({ version: 1, entries }, null, 2)}\n`);
  process.env.SECURITY_COMPONENT_AUDIT_LEDGER_PATH = ledgerPath;
  return dir;
}

afterEach(() => {
  if (previousLedgerPath === undefined) {
    delete process.env.TEMPLATE_AUDIT_LEDGER_PATH;
  } else {
    process.env.TEMPLATE_AUDIT_LEDGER_PATH = previousLedgerPath;
  }

  if (previousSeedDir === undefined) {
    delete process.env.TEMPLATE_SEED_DIR;
  } else {
    process.env.TEMPLATE_SEED_DIR = previousSeedDir;
  }

  if (previousSecurityLedgerPath === undefined) {
    delete process.env.SECURITY_COMPONENT_AUDIT_LEDGER_PATH;
  } else {
    process.env.SECURITY_COMPONENT_AUDIT_LEDGER_PATH = previousSecurityLedgerPath;
  }
});

describe('TemplateValidationLedgerService', () => {
  it('returns live-verified metadata for a current keep/completed ledger entry', () => {
    const dir = writeLedger({
      'API Surface Exposure Triage': {
        terminalStatus: 'COMPLETED',
        recommendation: 'keep',
        artifactsCount: 1,
        verifiedAt: '2026-06-21T07:15:23.121Z',
        rationale: 'Live execution completed and produced at least one artifact.',
      },
    });

    try {
      const result = new TemplateValidationLedgerService().getValidationForTemplate({
        name: 'API Surface Exposure Triage',
        updatedAt: '2026-06-21T07:13:11.025Z',
      });

      expect(result).toEqual({
        status: 'live-verified',
        recommendation: 'keep',
        terminalStatus: 'COMPLETED',
        artifactsCount: 1,
        verifiedAt: '2026-06-21T07:15:23.121Z',
        rationale: 'Live execution completed and produced at least one artifact.',
        isCurrent: true,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('marks validation stale when the template changed after verification', () => {
    const dir = writeLedger({
      'API Surface Exposure Triage': {
        terminalStatus: 'COMPLETED',
        recommendation: 'keep',
        artifactsCount: 1,
        verifiedAt: '2026-06-21T07:15:23.121Z',
        rationale: 'Live execution completed and produced at least one artifact.',
      },
    });

    try {
      const result = new TemplateValidationLedgerService().getValidationForTemplate({
        name: 'API Surface Exposure Triage',
        updatedAt: '2026-06-21T07:20:00.000Z',
      });

      expect(result.status).toBe('live-verified');
      expect(result.isCurrent).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps validation current when the ledger fingerprint still matches after a sync updated timestamp', () => {
    const seedFile = 'api-surface-exposure-triage.json';
    const seedTemplate = {
      _metadata: {
        name: 'API Surface Exposure Triage',
        description: 'Find exposed API surfaces.',
        category: 'bug-bounty',
        tags: ['api'],
        author: 'sentris-team',
        version: '1.0.0',
      },
      manifest: {
        name: 'API Surface Exposure Triage',
        category: 'bug-bounty',
        tags: ['api'],
      },
      graph: {
        nodes: [{ id: 'trigger_1', type: 'core.workflow.entrypoint' }],
        edges: [],
      },
      requiredSecrets: [],
    };
    const apiTemplate = {
      name: 'API Surface Exposure Triage',
      category: 'bug-bounty',
      path: `templates/${seedFile}`,
      graph: seedTemplate.graph,
      requiredSecrets: [],
      updatedAt: '2026-06-22T08:44:19.000Z',
    };
    const fingerprint = createTemplateValidationFingerprint({
      apiTemplate: {
        name: apiTemplate.name,
        category: apiTemplate.category,
        graph: apiTemplate.graph,
        requiredSecrets: apiTemplate.requiredSecrets,
      },
      seedTemplate,
      liveInputs: createTemplateLiveAuditInputs()[apiTemplate.name],
      classification: 'live-run',
      componentValidationFingerprints: {},
    });
    const ledgerDir = writeLedger({
      'API Surface Exposure Triage': {
        templateName: 'API Surface Exposure Triage',
        seedFile,
        fingerprint,
        terminalStatus: 'COMPLETED',
        recommendation: 'keep',
        artifactsCount: 1,
        verifiedAt: '2026-06-22T05:38:49.000Z',
        rationale: 'Live execution completed and produced at least one artifact.',
      },
    });
    const seedDir = writeSeedTemplate(seedFile, seedTemplate);

    try {
      const result = new TemplateValidationLedgerService().getValidationForTemplate(apiTemplate);

      expect(result.status).toBe('live-verified');
      expect(result.isCurrent).toBe(true);
    } finally {
      rmSync(ledgerDir, { recursive: true, force: true });
      rmSync(seedDir, { recursive: true, force: true });
    }
  });

  it('keeps validation current from live inputs stored in the ledger entry', () => {
    const seedFile = 'new-live-template.json';
    const seedTemplate = {
      manifest: {
        name: 'New Live Template Not In Backend Fixture Map',
        category: 'bug-bounty',
      },
      graph: {
        nodes: [
          { id: 'trigger_1', type: 'core.workflow.entrypoint' },
          { id: 'http_probe', type: 'core.http.request' },
        ],
        edges: [],
      },
      requiredSecrets: [],
    };
    const apiTemplate = {
      name: 'New Live Template Not In Backend Fixture Map',
      category: 'bug-bounty',
      path: `templates/${seedFile}`,
      graph: seedTemplate.graph,
      requiredSecrets: [],
      updatedAt: '2026-06-22T08:44:19.000Z',
    };
    const liveInputs = {
      graphqlEndpoint: 'https://example.test/graphql',
      sampleQuery: '{ __typename }',
    };
    const fingerprint = createTemplateValidationFingerprint({
      apiTemplate: {
        name: apiTemplate.name,
        category: apiTemplate.category,
        graph: apiTemplate.graph,
        requiredSecrets: apiTemplate.requiredSecrets,
      },
      seedTemplate,
      liveInputs,
      classification: 'live-run',
      componentValidationFingerprints: {},
    });
    const ledgerDir = writeLedger({
      'New Live Template Not In Backend Fixture Map': {
        templateName: 'New Live Template Not In Backend Fixture Map',
        seedFile,
        fingerprint,
        liveInputs,
        terminalStatus: 'COMPLETED',
        recommendation: 'keep',
        artifactsCount: 1,
        verifiedAt: '2026-06-22T05:38:49.000Z',
        rationale: 'Live execution completed and produced at least one artifact.',
      },
    });
    const seedDir = writeSeedTemplate(seedFile, seedTemplate);

    try {
      const result = new TemplateValidationLedgerService().getValidationForTemplate(apiTemplate);

      expect(result.status).toBe('live-verified');
      expect(result.isCurrent).toBe(true);
    } finally {
      rmSync(ledgerDir, { recursive: true, force: true });
      rmSync(seedDir, { recursive: true, force: true });
    }
  });

  it('marks validation stale when an affiliated security component validation fingerprint changed', () => {
    const seedFile = 'public-repo-code-iac-risk-triage.json';
    const seedTemplate = {
      manifest: {
        name: 'Public Repo Code & IaC Risk Triage',
        category: 'bug-bounty',
      },
      graph: {
        nodes: [
          { id: 'trigger_1', type: 'core.workflow.entrypoint' },
          { id: 'extract_repo_files', type: 'sentris.repository.files.extract' },
        ],
        edges: [],
      },
      requiredSecrets: [],
    };
    const apiTemplate = {
      name: 'Public Repo Code & IaC Risk Triage',
      category: 'bug-bounty',
      path: `templates/${seedFile}`,
      graph: seedTemplate.graph,
      requiredSecrets: [],
      updatedAt: '2026-06-22T08:44:19.000Z',
    };
    const fingerprint = createTemplateValidationFingerprint({
      apiTemplate: {
        name: apiTemplate.name,
        category: apiTemplate.category,
        graph: apiTemplate.graph,
        requiredSecrets: apiTemplate.requiredSecrets,
      },
      seedTemplate,
      liveInputs: createTemplateLiveAuditInputs()[apiTemplate.name],
      classification: 'live-run',
      componentValidationFingerprints: {
        'sentris.repository.files.extract': 'old-contract',
      },
    });
    const ledgerDir = writeLedger({
      'Public Repo Code & IaC Risk Triage': {
        templateName: 'Public Repo Code & IaC Risk Triage',
        seedFile,
        fingerprint,
        terminalStatus: 'COMPLETED',
        recommendation: 'keep',
        artifactsCount: 1,
        verifiedAt: '2026-06-22T05:38:49.000Z',
        rationale: 'Live execution completed and produced at least one artifact.',
      },
    });
    const seedDir = writeSeedTemplate(seedFile, seedTemplate);
    const securityLedgerDir = writeSecurityComponentLedger({
      'sentris.repository.files.extract': {
        componentId: 'sentris.repository.files.extract',
        fingerprint: 'new-contract',
        tier: 'A',
        status: 'passed',
        verifiedAt: '2026-06-22T09:00:00.000Z',
      },
    });

    try {
      const result = new TemplateValidationLedgerService().getValidationForTemplate(apiTemplate);

      expect(result.status).toBe('live-verified');
      expect(result.isCurrent).toBe(false);
    } finally {
      rmSync(ledgerDir, { recursive: true, force: true });
      rmSync(seedDir, { recursive: true, force: true });
      rmSync(securityLedgerDir, { recursive: true, force: true });
    }
  });

  it('keeps legacy validation fingerprints current when component validation is older', () => {
    const seedFile = 'bug-bounty-recon-triage.json';
    const seedTemplate = {
      manifest: {
        name: 'Bug Bounty Recon Triage',
        category: 'bug-bounty',
      },
      graph: {
        nodes: [
          { id: 'trigger_1', type: 'core.workflow.entrypoint' },
          { id: 'subfinder_discovery', type: 'sentris.subfinder.run' },
        ],
        edges: [],
      },
      requiredSecrets: [],
    };
    const apiTemplate = {
      name: 'Bug Bounty Recon Triage',
      category: 'bug-bounty',
      path: `templates/${seedFile}`,
      graph: seedTemplate.graph,
      requiredSecrets: [],
      updatedAt: '2026-06-22T08:44:19.000Z',
    };
    const legacyFingerprint = createTemplateValidationFingerprint({
      apiTemplate: {
        name: apiTemplate.name,
        category: apiTemplate.category,
        graph: apiTemplate.graph,
        requiredSecrets: apiTemplate.requiredSecrets,
      },
      seedTemplate,
      liveInputs: createTemplateLiveAuditInputs()[apiTemplate.name],
      classification: 'live-run',
    });
    const ledgerDir = writeLedger({
      'Bug Bounty Recon Triage': {
        templateName: 'Bug Bounty Recon Triage',
        seedFile,
        fingerprint: legacyFingerprint,
        terminalStatus: 'COMPLETED',
        recommendation: 'keep',
        artifactsCount: 1,
        verifiedAt: '2026-06-22T05:00:00.000Z',
        rationale: 'Live execution completed and produced at least one artifact.',
      },
    });
    const seedDir = writeSeedTemplate(seedFile, seedTemplate);
    const securityLedgerDir = writeSecurityComponentLedger({
      'sentris.subfinder.run': {
        componentId: 'sentris.subfinder.run',
        fingerprint: 'contract-before-template',
        tier: 'A',
        status: 'passed',
        verifiedAt: '2026-06-22T04:00:00.000Z',
      },
    });

    try {
      const result = new TemplateValidationLedgerService().getValidationForTemplate(apiTemplate);

      expect(result.status).toBe('live-verified');
      expect(result.isCurrent).toBe(true);
    } finally {
      rmSync(ledgerDir, { recursive: true, force: true });
      rmSync(seedDir, { recursive: true, force: true });
      rmSync(securityLedgerDir, { recursive: true, force: true });
    }
  });

  it('returns unknown metadata when no ledger entry exists', () => {
    const dir = writeLedger({});

    try {
      const result = new TemplateValidationLedgerService().getValidationForTemplate({
        name: 'Missing Template',
        updatedAt: '2026-06-21T07:20:00.000Z',
      });

      expect(result).toMatchObject({
        status: 'unknown',
        recommendation: 'unknown',
        artifactsCount: null,
        verifiedAt: null,
        isCurrent: false,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns requires-secrets metadata for credential-gated templates without a live ledger entry', () => {
    const dir = writeLedger({});

    try {
      const result = new TemplateValidationLedgerService().getValidationForTemplate({
        name: 'Supabase Project Exposure Triage',
        updatedAt: '2026-06-22T04:45:00.000Z',
        requiredSecrets: [
          {
            name: 'SUPABASE_DATABASE_URL',
            type: 'string',
            description: 'Postgres connection string from Supabase Project Settings.',
          },
        ],
      });

      expect(result).toEqual({
        status: 'requires-secrets',
        recommendation: 'review',
        terminalStatus: null,
        artifactsCount: null,
        verifiedAt: null,
        rationale:
          'Template is credential-gated and requires live secrets before execution: SUPABASE_DATABASE_URL.',
        isCurrent: true,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
