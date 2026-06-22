import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { TemplateValidationLedgerService } from '../template-validation-ledger.service';

const previousLedgerPath = process.env.TEMPLATE_AUDIT_LEDGER_PATH;

function writeLedger(entries: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), 'sentris-template-ledger-test-'));
  const ledgerPath = join(dir, 'template-live-audit-ledger.json');
  writeFileSync(ledgerPath, `${JSON.stringify({ version: 1, entries }, null, 2)}\n`);
  process.env.TEMPLATE_AUDIT_LEDGER_PATH = ledgerPath;
  return dir;
}

afterEach(() => {
  if (previousLedgerPath === undefined) {
    delete process.env.TEMPLATE_AUDIT_LEDGER_PATH;
  } else {
    process.env.TEMPLATE_AUDIT_LEDGER_PATH = previousLedgerPath;
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
        name: 'Security Scan Discord Report',
        updatedAt: '2026-06-22T04:45:00.000Z',
        requiredSecrets: [
          {
            name: 'DISCORD_WEBHOOK_URL',
            type: 'string',
            description: 'Discord Incoming Webhook URL for scan notifications',
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
          'Template is credential-gated and requires live secrets before execution: DISCORD_WEBHOOK_URL.',
        isCurrent: true,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
