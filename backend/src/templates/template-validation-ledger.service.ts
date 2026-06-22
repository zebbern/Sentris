import { Injectable } from '@nestjs/common';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type TemplateValidationStatus =
  | 'live-verified'
  | 'requires-secrets'
  | 'needs-fix'
  | 'needs-review'
  | 'unknown';

export interface TemplateValidationSummary {
  status: TemplateValidationStatus;
  recommendation: 'keep' | 'fix' | 'consolidate' | 'delete' | 'review' | 'unknown';
  terminalStatus?: string | null;
  artifactsCount?: number | null;
  verifiedAt?: string | null;
  rationale: string;
  isCurrent: boolean;
}

interface TemplateValidationLedgerEntry {
  terminalStatus?: string;
  recommendation?: string;
  rationale?: string;
  artifactsCount?: number;
  verifiedAt?: string;
}

interface TemplateValidationLedger {
  version?: number;
  entries?: Record<string, TemplateValidationLedgerEntry>;
}

interface TemplateRequiredSecretTarget {
  name?: string | null;
  type?: string | null;
  description?: string | null;
  placeholder?: string | null;
}

interface TemplateValidationTarget {
  name: string;
  updatedAt?: Date | string | null;
  requiredSecrets?: TemplateRequiredSecretTarget[] | null;
  manifest?: { requiredSecrets?: TemplateRequiredSecretTarget[] | null } | null;
}

const VALID_RECOMMENDATIONS = new Set(['keep', 'fix', 'consolidate', 'delete', 'review']);

@Injectable()
export class TemplateValidationLedgerService {
  getValidationForTemplate(template: TemplateValidationTarget): TemplateValidationSummary {
    const entry = this.findLedgerEntry(template.name);

    if (!entry) {
      const requiredSecretNames = this.getRequiredSecretNames(template);
      if (requiredSecretNames.length > 0) {
        return {
          status: 'requires-secrets',
          recommendation: 'review',
          terminalStatus: null,
          artifactsCount: null,
          verifiedAt: null,
          rationale: `Template is credential-gated and requires live secrets before execution: ${requiredSecretNames.join(', ')}.`,
          isCurrent: true,
        };
      }

      return {
        status: 'unknown',
        recommendation: 'unknown',
        terminalStatus: null,
        artifactsCount: null,
        verifiedAt: null,
        rationale: 'No live validation ledger entry found for this template.',
        isCurrent: false,
      };
    }

    const recommendation = this.normalizeRecommendation(entry.recommendation);
    const verifiedAt = typeof entry.verifiedAt === 'string' ? entry.verifiedAt : null;

    return {
      status: this.toStatus(recommendation, entry.terminalStatus),
      recommendation,
      terminalStatus: entry.terminalStatus ?? null,
      artifactsCount: Number.isFinite(entry.artifactsCount) ? entry.artifactsCount : null,
      verifiedAt,
      rationale:
        typeof entry.rationale === 'string' && entry.rationale.trim().length > 0
          ? entry.rationale
          : 'Live validation completed without a rationale.',
      isCurrent: this.isCurrent(template.updatedAt, verifiedAt),
    };
  }

  private findLedgerEntry(templateName: string): TemplateValidationLedgerEntry | null {
    for (const ledgerPath of this.ledgerPaths()) {
      if (!existsSync(ledgerPath)) continue;

      const ledger = this.readLedger(ledgerPath);
      const entry = ledger?.entries?.[templateName];
      if (entry) return entry;
    }

    return null;
  }

  private ledgerPaths(): string[] {
    const paths = [
      process.env.TEMPLATE_AUDIT_LEDGER_PATH,
      join(process.cwd(), '.cache', 'template-live-audit-ledger.json'),
      join(process.cwd(), '..', '.cache', 'template-live-audit-ledger.json'),
    ].filter((value): value is string => Boolean(value));

    return Array.from(new Set(paths));
  }

  private readLedger(ledgerPath: string): TemplateValidationLedger | null {
    try {
      const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8')) as TemplateValidationLedger;
      if (ledger?.version === 1 && ledger.entries && typeof ledger.entries === 'object') {
        return ledger;
      }
    } catch {
      return null;
    }

    return null;
  }

  private getRequiredSecretNames(template: TemplateValidationTarget): string[] {
    const requiredSecrets = Array.isArray(template.requiredSecrets)
      ? template.requiredSecrets
      : Array.isArray(template.manifest?.requiredSecrets)
        ? template.manifest.requiredSecrets
        : [];

    return requiredSecrets
      .map((secret) => secret?.name?.trim())
      .filter((name): name is string => Boolean(name));
  }

  private normalizeRecommendation(value: unknown): TemplateValidationSummary['recommendation'] {
    const recommendation = String(value || '').toLowerCase();
    return VALID_RECOMMENDATIONS.has(recommendation)
      ? (recommendation as TemplateValidationSummary['recommendation'])
      : 'unknown';
  }

  private toStatus(
    recommendation: TemplateValidationSummary['recommendation'],
    terminalStatus: string | undefined,
  ): TemplateValidationStatus {
    const terminal = String(terminalStatus || '').toUpperCase();
    if (recommendation === 'keep' && terminal === 'COMPLETED') return 'live-verified';
    if (
      recommendation === 'fix' ||
      ['FAILED', 'TIMED_OUT', 'CANCELLED', 'TERMINATED'].includes(terminal)
    ) {
      return 'needs-fix';
    }
    if (['review', 'consolidate', 'delete'].includes(recommendation)) return 'needs-review';
    return 'unknown';
  }

  private isCurrent(
    updatedAt: Date | string | null | undefined,
    verifiedAt: string | null,
  ): boolean {
    if (!verifiedAt) return false;
    if (!updatedAt) return true;

    const updatedTime = new Date(updatedAt).getTime();
    const verifiedTime = new Date(verifiedAt).getTime();

    if (!Number.isFinite(updatedTime) || !Number.isFinite(verifiedTime)) return true;
    return updatedTime <= verifiedTime;
  }
}
