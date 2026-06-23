import { Injectable } from '@nestjs/common';
import {
  createTemplateLiveAuditInputs,
  createTemplateValidationFingerprint,
  getTemplateComponentValidationFingerprints,
  getTemplateComponentValidationVerifiedAt,
  type TemplateValidationClassification,
} from '@sentris/shared/template-validation-fingerprint';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

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
  seedFile?: string | null;
  fingerprint?: string;
  liveInputs?: Record<string, unknown>;
  classification?: string;
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

interface SecurityComponentLedgerEntry {
  fingerprint?: string;
  status?: string;
}

interface SecurityComponentLedger {
  version?: number;
  entries?: Record<string, SecurityComponentLedgerEntry>;
}

interface TemplateRequiredSecretTarget {
  name?: string | null;
  type?: string | null;
  description?: string | null;
  placeholder?: string | null;
}

interface TemplateValidationTarget {
  name: string;
  category?: string | null;
  path?: string | null;
  updatedAt?: Date | string | null;
  requiredSecrets?: TemplateRequiredSecretTarget[] | null;
  graph?: Record<string, unknown> | null;
  manifest?: { requiredSecrets?: TemplateRequiredSecretTarget[] | null } | null;
}

const VALID_RECOMMENDATIONS = new Set(['keep', 'fix', 'consolidate', 'delete', 'review']);
const VALID_CLASSIFICATIONS = new Set<TemplateValidationClassification>([
  'live-run',
  'credential-gated',
  'run-start-probe',
]);

@Injectable()
export class TemplateValidationLedgerService {
  private readonly liveAuditInputs = createTemplateLiveAuditInputs();

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
      isCurrent: this.isCurrent(template, entry, verifiedAt),
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
    const configuredPath = process.env.TEMPLATE_AUDIT_LEDGER_PATH?.trim();
    if (configuredPath) return [configuredPath];

    const paths = [
      join(process.cwd(), '.cache', 'template-live-audit-ledger.json'),
      join(process.cwd(), '..', '.cache', 'template-live-audit-ledger.json'),
    ];

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
    template: TemplateValidationTarget,
    entry: TemplateValidationLedgerEntry,
    verifiedAt: string | null,
  ): boolean {
    const fingerprintCurrent = this.isFingerprintCurrent(template, entry);
    if (fingerprintCurrent !== null) return fingerprintCurrent;

    return this.isTimestampCurrent(template.updatedAt, verifiedAt);
  }

  private isTimestampCurrent(
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

  private isFingerprintCurrent(
    template: TemplateValidationTarget,
    entry: TemplateValidationLedgerEntry,
  ): boolean | null {
    if (typeof entry.fingerprint !== 'string' || entry.fingerprint.length === 0) {
      return null;
    }

    const seedTemplate = this.readSeedTemplate(template, entry);
    const liveInputs = this.getLedgerLiveInputs(entry) ?? this.liveAuditInputs[template.name] ?? {};
    const componentSource = seedTemplate ?? { graph: template.graph ?? null };
    const securityComponentLedger = this.readSecurityComponentLedger();
    const componentValidationFingerprints = getTemplateComponentValidationFingerprints(
      componentSource,
      securityComponentLedger,
    );
    const componentValidationVerifiedAt = getTemplateComponentValidationVerifiedAt(
      componentSource,
      securityComponentLedger,
    );
    const apiTemplate = {
      name: template.name,
      category: template.category ?? null,
      graph: template.graph ?? null,
      requiredSecrets: this.getRequiredSecrets(template),
    };

    return this.getCandidateClassifications(template, entry, liveInputs).some(
      (classification) => {
        const currentFingerprint = createTemplateValidationFingerprint({
          apiTemplate,
          seedTemplate: seedTemplate ?? null,
          liveInputs,
          classification,
          componentValidationFingerprints,
        });
        if (currentFingerprint === entry.fingerprint) return true;

        const legacyFingerprint = createTemplateValidationFingerprint({
          apiTemplate,
          seedTemplate: seedTemplate ?? null,
          liveInputs,
          classification,
        });
        return this.legacyFingerprintStillCoversComponents(
          entry,
          legacyFingerprint,
          componentValidationVerifiedAt,
        );
      },
    );
  }

  private legacyFingerprintStillCoversComponents(
    entry: TemplateValidationLedgerEntry,
    legacyFingerprint: string,
    componentValidationVerifiedAt: Record<string, string>,
  ): boolean {
    if (entry.fingerprint !== legacyFingerprint) return false;

    const componentTimes = Object.values(componentValidationVerifiedAt);
    if (componentTimes.length === 0) return true;

    const templateVerifiedAt = this.parseValidationTime(entry.verifiedAt);
    if (templateVerifiedAt === null) return false;

    return componentTimes.every((value) => {
      const componentVerifiedAt = this.parseValidationTime(value);
      return componentVerifiedAt !== null && componentVerifiedAt <= templateVerifiedAt;
    });
  }

  private parseValidationTime(value: string | undefined): number | null {
    if (!value) return null;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  private getCandidateClassifications(
    template: TemplateValidationTarget,
    entry: TemplateValidationLedgerEntry,
    liveInputs: Record<string, unknown>,
  ): TemplateValidationClassification[] {
    const storedClassification = this.normalizeClassification(entry.classification);
    if (storedClassification) return [storedClassification];

    const hasLiveInputs = Object.keys(liveInputs).length > 0;
    const requiredSecretCount = this.getRequiredSecretNames(template).length;

    if (hasLiveInputs && requiredSecretCount === 0) return ['live-run'];
    if (hasLiveInputs) return ['live-run', 'credential-gated'];
    if (requiredSecretCount > 0) return ['live-run', 'run-start-probe', 'credential-gated'];
    return ['run-start-probe', 'live-run'];
  }

  private normalizeClassification(value: unknown): TemplateValidationClassification | null {
    return typeof value === 'string' &&
      VALID_CLASSIFICATIONS.has(value as TemplateValidationClassification)
      ? (value as TemplateValidationClassification)
      : null;
  }

  private getLedgerLiveInputs(
    entry: TemplateValidationLedgerEntry,
  ): Record<string, unknown> | null {
    return entry.liveInputs && typeof entry.liveInputs === 'object' && !Array.isArray(entry.liveInputs)
      ? entry.liveInputs
      : null;
  }

  private readSeedTemplate(
    template: TemplateValidationTarget,
    entry: TemplateValidationLedgerEntry,
  ): Record<string, unknown> | null {
    const seedFile = this.getSeedFileName(template, entry);
    if (!seedFile) return null;

    for (const seedPath of this.seedPaths(seedFile)) {
      if (!existsSync(seedPath)) continue;

      try {
        const parsed = JSON.parse(readFileSync(seedPath, 'utf8')) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        return null;
      }
    }

    return null;
  }

  private readSecurityComponentLedger(): SecurityComponentLedger | null {
    for (const ledgerPath of this.securityComponentLedgerPaths()) {
      if (!existsSync(ledgerPath)) continue;

      try {
        const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8')) as SecurityComponentLedger;
        if (ledger?.version === 1 && ledger.entries && typeof ledger.entries === 'object') {
          return ledger;
        }
      } catch {
        return null;
      }
    }

    return null;
  }

  private securityComponentLedgerPaths(): string[] {
    const configuredPath = process.env.SECURITY_COMPONENT_AUDIT_LEDGER_PATH?.trim();
    if (configuredPath) return [configuredPath];

    return Array.from(
      new Set([
        join(process.cwd(), '.cache', 'security-component-audit-ledger.json'),
        join(process.cwd(), '..', '.cache', 'security-component-audit-ledger.json'),
      ]),
    );
  }

  private getSeedFileName(
    template: TemplateValidationTarget,
    entry: TemplateValidationLedgerEntry,
  ): string | null {
    if (typeof entry.seedFile === 'string' && entry.seedFile.trim().length > 0) {
      return basename(entry.seedFile);
    }

    if (typeof template.path === 'string' && template.path.trim().length > 0) {
      const fileName = basename(template.path);
      if (fileName.endsWith('.json') || fileName.endsWith('.jsonc')) return fileName;
    }

    return null;
  }

  private seedPaths(seedFile: string): string[] {
    const configuredPath = process.env.TEMPLATE_SEED_DIR?.trim();
    const paths = configuredPath
      ? [join(configuredPath, seedFile)]
      : [
          join(process.cwd(), 'scripts', 'seed-templates', seedFile),
          join(process.cwd(), '..', 'scripts', 'seed-templates', seedFile),
        ];

    return Array.from(new Set(paths));
  }

  private getRequiredSecrets(template: TemplateValidationTarget): TemplateRequiredSecretTarget[] {
    return Array.isArray(template.requiredSecrets)
      ? template.requiredSecrets
      : Array.isArray(template.manifest?.requiredSecrets)
        ? template.manifest.requiredSecrets
        : [];
  }
}
