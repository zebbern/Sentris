import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export {
  SECURITY_COMPONENT_IDS,
  buildSecurityComponentManifest,
  getSecurityComponentInvariantFailures,
  PARAMETER_FIELD_RENDERABLE_TYPES,
  summarizeField,
  type SecurityComponentId,
  type SecurityComponentFieldSummary,
  type SecurityComponentManifestEntry,
  type SecurityComponentInvariantFailure,
} from '../worker/src/components/security/security-component-manifest.ts';
import type { SecurityComponentId } from '../worker/src/components/security/security-component-manifest.ts';
import { SECURITY_COMPONENT_IDS } from '../worker/src/components/security/security-component-manifest.ts';

export interface SecurityComponentAuditFixture {
  tier: 'A' | 'B' | 'C';
  inputs: Record<string, unknown>;
  params: Record<string, unknown>;
  requiresSecrets?: string[];
  skipReason?: string;
}

export interface SecurityComponentLedgerEntry {
  componentId: SecurityComponentId;
  fingerprint: string;
  tier: 'A' | 'B' | 'C';
  status: 'passed' | 'failed' | 'skipped';
  durationMs?: number;
  error?: string;
  verifiedAt: string;
}

export interface SecurityComponentLedger {
  version: 1;
  entries: Record<string, SecurityComponentLedgerEntry>;
}

export interface SecurityComponentAuditCliOptions {
  force: boolean;
  ledgerCheckOnly: boolean;
  componentIds: Set<string>;
  sequential: boolean;
}

export function parseSecurityComponentAuditCliOptions(argv: string[]): SecurityComponentAuditCliOptions {
  const componentIds = new Set<string>();
  let force = false;
  let ledgerCheckOnly = false;
  let sequential = true;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--force') {
      force = true;
      continue;
    }
    if (arg === '--ledger-check') {
      ledgerCheckOnly = true;
      continue;
    }
    if (arg === '--sequential') {
      sequential = true;
      continue;
    }
    if (arg === '--filter' && argv[index + 1]) {
      componentIds.add(argv[index + 1]!);
      index += 1;
      continue;
    }
  }

  return { force, ledgerCheckOnly, componentIds, sequential };
}

export function createSecurityComponentFingerprint(
  componentId: string,
  fixture: SecurityComponentAuditFixture,
): string {
  return createHash('sha256')
    .update(JSON.stringify({ componentId, inputs: fixture.inputs, params: fixture.params }))
    .digest('hex')
    .slice(0, 16);
}

export const SECURITY_COMPONENT_LIVE_FIXTURES: Record<
  SecurityComponentId,
  SecurityComponentAuditFixture
> = {
  'sentris.subfinder.run': {
    tier: 'A',
    inputs: { domains: ['scanme.nmap.org'] },
    params: {},
  },
  'sentris.amass.enum': {
    tier: 'A',
    inputs: { domains: ['scanme.nmap.org'] },
    params: { mode: 'passive', timeout: 2 },
  },
  'sentris.naabu.scan': {
    tier: 'B',
    inputs: { targets: ['scanme.nmap.org'] },
    params: { ports: '80,443', rate: 500, timeout: 120 },
  },
  'sentris.dnsx.run': {
    tier: 'A',
    inputs: { domains: ['scanme.nmap.org'] },
    params: { recordTypes: ['A'], outputMode: 'json' },
  },
  'sentris.httpx.scan': {
    tier: 'A',
    inputs: { targets: ['https://scanme.nmap.org'] },
    params: { ports: '443', timeout: 30 },
  },
  'sentris.nuclei.scan': {
    tier: 'B',
    inputs: {
      targets: ['http://scanme.nmap.org'],
      customTemplateYaml: [
        'id: audit-smoke',
        'info:',
        '  name: Audit Smoke Test',
        '  severity: info',
        '  author: sentris',
        'http:',
        '  - method: GET',
        '    path:',
        '      - "{{BaseURL}}"',
        '    matchers:',
        '      - type: status',
        '        status:',
        '          - 200',
      ].join('\n'),
    },
    params: { rateLimit: 10, timeout: 60, updateTemplates: false },
  },
  'sentris.supabase.scanner': {
    tier: 'C',
    inputs: { supabaseUrl: 'https://example.supabase.co' },
    params: {},
    requiresSecrets: ['SUPABASE_SCANNER_TARGET'],
    skipReason: 'Requires a real Supabase project URL',
  },
  'sentris.notify.dispatch': {
    tier: 'C',
    inputs: { messages: ['security component audit'] },
    params: { providerIds: ['slack'] },
    requiresSecrets: ['NOTIFY_PROVIDER_CONFIG'],
    skipReason: 'Requires provider configuration YAML',
  },
  'security.prowler.scan': {
    tier: 'C',
    inputs: { accountId: '000000000000', regions: 'us-east-1' },
    params: { scanMode: 'aws' },
    requiresSecrets: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'],
    skipReason: 'Requires AWS credentials',
  },
  'sentris.shuffledns.massdns': {
    tier: 'B',
    inputs: {
      domains: ['example.com'],
      words: ['www', 'api'],
      resolvers: ['1.1.1.1'],
    },
    params: { mode: 'bruteforce', threads: 10, timeout: 60 },
  },
  'sentris.trufflehog.scan': {
    tier: 'B',
    inputs: { scanTarget: 'audit-smoke' },
    params: {
      scanType: 'filesystem',
      onlyVerified: false,
      jsonOutput: true,
      filesystemContent: {
        'readme.txt': 'security component audit smoke test',
      },
    },
  },
  'sentris.security.terminal-demo': {
    tier: 'A',
    inputs: {},
    params: { message: 'audit', durationSeconds: 5 },
  },
  'security.virustotal.lookup': {
    tier: 'C',
    inputs: { indicator: '8.8.8.8', apiKey: 'test-key' },
    params: { type: 'ip' },
    requiresSecrets: ['VIRUSTOTAL_API_KEY'],
    skipReason: 'Requires VirusTotal API key',
  },
  'security.abuseipdb.check': {
    tier: 'C',
    inputs: { ipAddress: '8.8.8.8', apiKey: 'test-key' },
    params: { maxAgeInDays: 90 },
    requiresSecrets: ['ABUSEIPDB_API_KEY'],
    skipReason: 'Requires AbuseIPDB API key',
  },
  'mcp.group.aws': {
    tier: 'C',
    inputs: {
      credentials: {
        accessKeyId: 'test',
        secretAccessKey: 'test',
      },
    },
    params: { enabledServers: ['aws-documentation'] },
    requiresSecrets: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'],
    skipReason: 'Requires valid AWS credentials for MCP group',
  },
  'sentris.testssl.run': {
    tier: 'B',
    inputs: { target: 'scanme.nmap.org' },
    params: { timeout: 120 },
  },
  'sentris.checkov.run': {
    tier: 'B',
    inputs: {
      target: '# FILE: main.tf\nresource "aws_s3_bucket" "b" { bucket = "audit-test" }\n',
    },
    params: { framework: 'terraform', compact: true },
  },
  'sentris.theharvester.run': {
    tier: 'A',
    inputs: { domain: 'scanme.nmap.org' },
    params: { sources: 'bing' },
  },
  'sentris.wafw00f.run': {
    tier: 'B',
    inputs: { targets: ['https://scanme.nmap.org'] },
    params: { timeout: 60 },
  },
  'sentris.katana.run': {
    tier: 'A',
    inputs: { seedUrls: ['https://scanme.nmap.org'] },
    params: { depth: 1, timeout: 60 },
  },
  'sentris.ffuf.run': {
    tier: 'B',
    inputs: { target: 'https://scanme.nmap.org/FUZZ', wordlist: 'admin\napi' },
    params: { timeout: 60 },
  },
  'sentris.trivy.run': {
    tier: 'B',
    inputs: { target: 'alpine:3.19' },
    params: { scanType: 'image', format: 'json', timeout: 180 },
  },
  'sentris.semgrep.run': {
    tier: 'B',
    inputs: { target: 'console.log("audit");' },
    params: { config: 'p/ci', timeout: 120 },
  },
  'sentris.repository.files.extract': {
    tier: 'A',
    inputs: { repositoryUrl: 'https://github.com/OWASP/NodeGoat' },
    params: { maxFiles: 5 },
  },
  'sentris.repository.manifest.extract': {
    tier: 'A',
    inputs: { repositoryUrl: 'https://github.com/OWASP/NodeGoat' },
    params: {},
  },
  'sentris.osv.query': {
    tier: 'A',
    inputs: { packageSpecs: ['lodash@4.17.20'] },
    params: { ecosystem: 'npm' },
  },
  'sentris.nvd.cve.query': {
    tier: 'A',
    inputs: { cveIds: ['CVE-2021-44228'] },
    params: {},
  },
  'sentris.yara.run': {
    tier: 'B',
    inputs: {
      target: 'audit test string',
      rules: 'rule audit { strings: $a = "audit" condition: $a }',
    },
    params: { timeout: 60 },
  },
};

export function getDefaultLedgerPath(): string {
  return join(process.cwd(), '.cache', 'security-component-audit-ledger.json');
}

export function readSecurityComponentLedger(
  path = getDefaultLedgerPath(),
): SecurityComponentLedger | undefined {
  if (!existsSync(path)) {
    return undefined;
  }
  return JSON.parse(readFileSync(path, 'utf8')) as SecurityComponentLedger;
}

export function writeSecurityComponentLedger(
  ledger: SecurityComponentLedger,
  path = getDefaultLedgerPath(),
): void {
  writeFileSync(path, JSON.stringify(ledger, null, 2));
}

export function upsertSecurityComponentLedgerEntry(
  ledger: SecurityComponentLedger,
  entry: SecurityComponentLedgerEntry,
): SecurityComponentLedger {
  return {
    version: 1,
    entries: {
      ...ledger.entries,
      [entry.componentId]: entry,
    },
  };
}

export interface SecurityComponentFreshnessItem {
  componentId: SecurityComponentId;
  tier: 'A' | 'B' | 'C';
  status: 'current' | 'missing' | 'stale' | 'failed' | 'skipped';
  fingerprint: string;
  rationale: string;
  verifiedAt?: string;
}

export function summarizeSecurityComponentLedgerFreshness(
  ledger: SecurityComponentLedger | undefined,
  componentIds: SecurityComponentId[] = [...SECURITY_COMPONENT_IDS],
): { allCurrent: boolean; items: SecurityComponentFreshnessItem[] } {
  const items: SecurityComponentFreshnessItem[] = componentIds.map((componentId) => {
    const fixture = SECURITY_COMPONENT_LIVE_FIXTURES[componentId];
    const fingerprint = createSecurityComponentFingerprint(componentId, fixture);
    const entry = ledger?.entries[componentId];

    if (fixture.skipReason || (fixture.requiresSecrets?.length ?? 0) > 0) {
      const hasSecrets = (fixture.requiresSecrets ?? []).every(
        (name) => process.env[name]?.trim(),
      );
      if (!hasSecrets) {
        return {
          componentId,
          tier: fixture.tier,
          status: 'skipped',
          fingerprint,
          rationale: fixture.skipReason ?? 'Missing required secrets',
          verifiedAt: entry?.verifiedAt,
        };
      }
    }

    if (!entry) {
      return {
        componentId,
        tier: fixture.tier,
        status: 'missing',
        fingerprint,
        rationale: 'No ledger entry',
      };
    }

    if (entry.fingerprint !== fingerprint) {
      return {
        componentId,
        tier: fixture.tier,
        status: 'stale',
        fingerprint,
        rationale: 'Fixture fingerprint changed',
        verifiedAt: entry.verifiedAt,
      };
    }

    if (entry.status === 'failed') {
      return {
        componentId,
        tier: fixture.tier,
        status: 'failed',
        fingerprint,
        rationale: entry.error ?? 'Previous live audit failed',
        verifiedAt: entry.verifiedAt,
      };
    }

    if (entry.status === 'skipped') {
      return {
        componentId,
        tier: fixture.tier,
        status: 'skipped',
        fingerprint,
        rationale: entry.error ?? 'Skipped',
        verifiedAt: entry.verifiedAt,
      };
    }

    return {
      componentId,
      tier: fixture.tier,
      status: 'current',
      fingerprint,
      rationale: 'Ledger matches fixture fingerprint',
      verifiedAt: entry.verifiedAt,
    };
  });

  const allCurrent = items.every(
    (item) =>
      item.status === 'current' ||
      item.status === 'skipped' ||
      item.status === 'missing',
  );

  return { allCurrent, items };
}

export function renderSecurityComponentLedgerFreshness(summary: {
  allCurrent: boolean;
  items: SecurityComponentFreshnessItem[];
}): string {
  const lines = summary.items
    .sort((a, b) => a.componentId.localeCompare(b.componentId))
    .map(
      (item) =>
        `- ${item.componentId} [${item.tier}] ${item.status}${item.verifiedAt ? ` (${item.verifiedAt})` : ''}: ${item.rationale}`,
    );

  return [`Security component ledger: ${summary.allCurrent ? 'CURRENT' : 'NEEDS ATTENTION'}`, ...lines].join(
    '\n',
  );
}

export function shouldSkipSecurityComponentLiveAudit(options: {
  ledger: SecurityComponentLedger | undefined;
  componentId: SecurityComponentId;
  fingerprint: string;
  force: boolean;
  fixture: SecurityComponentAuditFixture;
}): SecurityComponentLedgerEntry | undefined {
  if (options.force) {
    return undefined;
  }

  if (options.fixture.skipReason && !(options.fixture.requiresSecrets ?? []).some((name) => process.env[name]?.trim())) {
    return {
      componentId: options.componentId,
      fingerprint: options.fingerprint,
      tier: options.fixture.tier,
      status: 'skipped',
      error: options.fixture.skipReason,
      verifiedAt: new Date().toISOString(),
    };
  }

  const existing = options.ledger?.entries[options.componentId];
  if (existing?.fingerprint === options.fingerprint && existing.status === 'passed') {
    return existing;
  }

  return undefined;
}
