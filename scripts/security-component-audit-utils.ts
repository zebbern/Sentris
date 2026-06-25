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
  envInputOverrides?: Record<string, string>;
  envParamOverrides?: Record<string, string>;
  localDockerBuild?: SecurityComponentLocalDockerBuild;
  requiresSecrets?: string[];
  skipReason?: string;
}

export interface SecurityComponentLocalDockerBuild {
  image: string;
  context: string;
  dockerfile?: string;
}

export interface SecurityComponentDockerBuildPlan {
  image: string;
  context: string;
  dockerfile?: string;
  args: string[];
}

export interface SecurityComponentContractField {
  id: string;
  label?: string;
  type?: string;
  required?: boolean;
  default?: unknown;
}

export interface SecurityComponentContractSnapshot {
  id?: string;
  label?: string;
  runnerKind?: string;
  runnerImage?: string | null;
  inputs?: SecurityComponentContractField[];
  outputs?: SecurityComponentContractField[];
  parameters?: SecurityComponentContractField[];
}

interface SecurityComponentMetadataLike {
  definition?: {
    id?: string;
    label?: string;
    runner?: {
      kind?: string;
      image?: string;
    };
  };
  inputs?: SecurityComponentContractField[];
  outputs?: SecurityComponentContractField[];
  parameters?: SecurityComponentContractField[];
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

export function parseSecurityComponentAuditCliOptions(
  argv: string[],
): SecurityComponentAuditCliOptions {
  const componentIds = new Set<string>();
  const validComponentIds = new Set<string>(SECURITY_COMPONENT_IDS);
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
    if (arg === '--filter') {
      const componentId = argv[index + 1];
      if (!componentId || componentId.startsWith('--')) {
        throw new Error('--filter requires a component id');
      }
      if (!validComponentIds.has(componentId)) {
        throw new Error(`Unknown security component filter: ${componentId}`);
      }
      componentIds.add(componentId);
      index += 1;
      continue;
    }
    if (arg.startsWith('--')) {
      throw new Error(`Unknown security component audit option: ${arg}`);
    }
    throw new Error(`Unknown security component audit argument: ${arg}`);
  }

  return { force, ledgerCheckOnly, componentIds, sequential };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
    return `{${entries.join(',')}}`;
  }

  return JSON.stringify(value);
}

function cloneFixtureValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneFixtureValue(item)) as T;
  }

  if (value && typeof value === 'object') {
    const cloned: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      cloned[key] = cloneFixtureValue(child);
    }
    return cloned as T;
  }

  return value;
}

function setFixturePath(target: Record<string, unknown>, path: string, value: string): void {
  const parts = path.split('.').filter(Boolean);
  if (parts.length === 0) return;

  let current: Record<string, unknown> = target;
  for (const part of parts.slice(0, -1)) {
    const next = current[part];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  current[parts[parts.length - 1]!] = value;
}

function applyEnvOverrides(
  target: Record<string, unknown>,
  overrides: Record<string, string> | undefined,
  env: Record<string, string | undefined>,
): void {
  for (const [path, envName] of Object.entries(overrides ?? {})) {
    const envValue = env[envName]?.trim();
    if (!envValue) continue;
    setFixturePath(target, path, envValue);
  }
}

export function materializeSecurityComponentAuditFixture(
  fixture: SecurityComponentAuditFixture,
  env: Record<string, string | undefined> = process.env,
): SecurityComponentAuditFixture {
  const inputs = cloneFixtureValue(fixture.inputs);
  const params = cloneFixtureValue(fixture.params);

  applyEnvOverrides(inputs, fixture.envInputOverrides, env);
  applyEnvOverrides(params, fixture.envParamOverrides, env);

  return {
    ...fixture,
    inputs,
    params,
  };
}

function hasFixtureExecutionMetadata(fixture: SecurityComponentAuditFixture): boolean {
  return Boolean(
    fixture.envInputOverrides || fixture.envParamOverrides || fixture.localDockerBuild,
  );
}

export function createSecurityComponentDockerBuildPlan(
  fixture: SecurityComponentAuditFixture,
  imageExists: (image: string) => boolean,
): SecurityComponentDockerBuildPlan | undefined {
  const localDockerBuild = fixture.localDockerBuild;
  if (!localDockerBuild || imageExists(localDockerBuild.image)) {
    return undefined;
  }

  const args = [
    'build',
    '-t',
    localDockerBuild.image,
    ...(localDockerBuild.dockerfile ? ['-f', localDockerBuild.dockerfile] : []),
    localDockerBuild.context,
  ];

  return {
    image: localDockerBuild.image,
    context: localDockerBuild.context,
    ...(localDockerBuild.dockerfile ? { dockerfile: localDockerBuild.dockerfile } : {}),
    args,
  };
}

export function createSecurityComponentFingerprint(
  componentId: string,
  fixture: SecurityComponentAuditFixture,
  contract?: SecurityComponentContractSnapshot | null,
): string {
  return createHash('sha256')
    .update(
      stableStringify({
        componentId,
        inputs: fixture.inputs,
        params: fixture.params,
        ...(fixture.envInputOverrides ? { envInputOverrides: fixture.envInputOverrides } : {}),
        ...(fixture.envParamOverrides ? { envParamOverrides: fixture.envParamOverrides } : {}),
        ...(fixture.localDockerBuild ? { localDockerBuild: fixture.localDockerBuild } : {}),
        ...(contract ? { contract } : {}),
      }),
    )
    .digest('hex')
    .slice(0, 16);
}

function summarizeContractField(
  field: SecurityComponentContractField,
): SecurityComponentContractField {
  return {
    id: field.id,
    ...(field.label !== undefined ? { label: field.label } : {}),
    ...(field.type !== undefined ? { type: field.type } : {}),
    ...(field.required !== undefined ? { required: field.required } : {}),
    ...(field.default !== undefined ? { default: field.default } : {}),
  };
}

export function createSecurityComponentContractSnapshot(
  metadata: SecurityComponentMetadataLike | undefined,
): SecurityComponentContractSnapshot | null {
  if (!metadata?.definition?.id) return null;

  const runner = metadata.definition.runner;
  return {
    id: metadata.definition.id,
    label: metadata.definition.label,
    runnerKind: runner?.kind,
    runnerImage: runner?.kind === 'docker' ? (runner.image ?? null) : null,
    inputs: (metadata.inputs ?? []).map(summarizeContractField),
    outputs: (metadata.outputs ?? []).map(summarizeContractField),
    parameters: (metadata.parameters ?? []).map(summarizeContractField),
  };
}

function createLegacySecurityComponentFingerprint(
  componentId: string,
  fixture: SecurityComponentAuditFixture,
): string {
  return createHash('sha256')
    .update(JSON.stringify({ componentId, inputs: fixture.inputs, params: fixture.params }))
    .digest('hex')
    .slice(0, 16);
}

function hasMatchingSecurityComponentFingerprint(
  entry: SecurityComponentLedgerEntry | undefined,
  componentId: string,
  fixture: SecurityComponentAuditFixture,
  fingerprint: string,
  contract?: SecurityComponentContractSnapshot | null,
): boolean {
  if (!entry) return false;
  if (entry.fingerprint === fingerprint) return true;
  if (contract) return false;

  const acceptsLegacyFingerprint = !hasFixtureExecutionMetadata(fixture);
  return (
    entry.fingerprint === createSecurityComponentFingerprint(componentId, fixture) ||
    (acceptsLegacyFingerprint &&
      entry.fingerprint === createLegacySecurityComponentFingerprint(componentId, fixture))
  );
}

function isPreContractSecurityComponentFingerprint(
  entry: SecurityComponentLedgerEntry,
  componentId: string,
  fixture: SecurityComponentAuditFixture,
): boolean {
  return (
    entry.fingerprint === createSecurityComponentFingerprint(componentId, fixture) ||
    entry.fingerprint === createLegacySecurityComponentFingerprint(componentId, fixture)
  );
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
    inputs: { supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co' },
    params: { failOnCritical: false },
    envInputOverrides: {
      supabaseUrl: 'SUPABASE_SCANNER_TARGET',
      databaseConnectionString: 'SUPABASE_DATABASE_URL',
      serviceRoleKey: 'SUPABASE_SERVICE_ROLE_KEY',
    },
    localDockerBuild: {
      image: 'ghcr.io/zebbern/supabase-scanner:latest',
      context: 'docker/supabase-scanner',
    },
    requiresSecrets: ['SUPABASE_DATABASE_URL'],
    skipReason: 'Requires Supabase Postgres connection string for read-only scanner live audit',
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
    envInputOverrides: { apiKey: 'VIRUSTOTAL_API_KEY' },
    requiresSecrets: ['VIRUSTOTAL_API_KEY'],
    skipReason: 'Requires VirusTotal API key',
  },
  'security.abuseipdb.check': {
    tier: 'C',
    inputs: { ipAddress: '8.8.8.8', apiKey: 'test-key' },
    params: { maxAgeInDays: 90 },
    envInputOverrides: { apiKey: 'ABUSEIPDB_API_KEY' },
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
    envInputOverrides: {
      'credentials.accessKeyId': 'AWS_ACCESS_KEY_ID',
      'credentials.secretAccessKey': 'AWS_SECRET_ACCESS_KEY',
    },
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
  'sentris.opengrep.run': {
    tier: 'B',
    inputs: { target: 'console.log("audit");' },
    params: { config: 'p/ci', timeoutSeconds: 120 },
  },
  'sentris.codeql.run': {
    tier: 'B',
    inputs: { target: '# FILE: index.js\nconsole.log("audit");\n' },
    params: {
      language: 'javascript-typescript',
      querySuite: 'security-extended',
      timeoutSeconds: 300,
    },
  },
  'sentris.jazzer-js.run': {
    tier: 'B',
    inputs: { fuzzTargets: [] },
    params: { timeoutSeconds: 30, maxCrashes: 1 },
  },
  'sentris.repository.files.extract': {
    tier: 'A',
    inputs: { repositoryUrl: 'https://github.com/OWASP/NodeGoat' },
    params: { maxTotalBytes: 250_000 },
  },
  'sentris.github.repository.clone': {
    tier: 'A',
    inputs: {
      repositoryUrl: 'https://github.com/octocat/Hello-World',
      ref: 'master',
    },
    params: {
      refKind: 'branch',
      emitSourceBundle: true,
      maxFileBytes: 500_000,
      maxTotalBytes: 5_000_000,
      maxArchiveBytes: 500_000_000,
    },
  },
  'sentris.repository.manifest.extract': {
    tier: 'A',
    inputs: { repositoryUrl: 'https://github.com/OWASP/NodeGoat' },
    params: {},
  },
  'sentris.osv.query': {
    tier: 'A',
    inputs: {
      packageSpecs: [
        'npm:lodash@4.17.20',
        'PyPI:django@4.2.7',
        'Maven:org.apache.logging.log4j:log4j-core@2.14.1',
      ],
    },
    params: {
      ecosystem: 'npm',
      severityFloor: 'unknown',
      hydrateAdvisories: false,
      maxAdvisoriesPerPackage: 5,
      includeUnknownSeverity: true,
    },
  },
  'sentris.npm.registry.intel': {
    tier: 'A',
    inputs: {
      packageSpecs: ['lodash@4.17.21', '@types/node@20.0.0'],
      typosquatCandidates: ['lodas', 'types-node'],
    },
    params: {
      maxPackages: 5,
      recentPublishDays: 90,
      includeRawMetadata: false,
    },
  },
  'sentris.npm.package.source': {
    tier: 'A',
    inputs: {
      packageSpec: 'source-map-js@1.2.1',
    },
    params: {
      emitSourceBundle: true,
      maxFileBytes: 500_000,
      maxTotalBytes: 5_000_000,
      maxArchiveBytes: 500_000_000,
    },
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

export function pruneSecurityComponentLedger(
  ledger: SecurityComponentLedger | undefined,
  activeComponentIds: Iterable<string>,
): SecurityComponentLedger | undefined {
  if (!ledger) return undefined;

  const activeIds = new Set(activeComponentIds);
  const entries = Object.fromEntries(
    Object.entries(ledger.entries).filter(([componentId]) => activeIds.has(componentId)),
  );

  return {
    version: 1,
    entries,
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
  metadataEntries: SecurityComponentMetadataLike[] = [],
): { allCurrent: boolean; items: SecurityComponentFreshnessItem[] } {
  const metadataById = new Map(
    metadataEntries
      .filter((entry) => typeof entry.definition?.id === 'string')
      .map((entry) => [entry.definition!.id!, entry]),
  );
  const items: SecurityComponentFreshnessItem[] = componentIds.map((componentId) => {
    const fixture = SECURITY_COMPONENT_LIVE_FIXTURES[componentId];
    const contract = createSecurityComponentContractSnapshot(metadataById.get(componentId));
    const fingerprint = createSecurityComponentFingerprint(componentId, fixture, contract);
    const entry = ledger?.entries[componentId];
    const requiredSecrets = fixture.requiresSecrets ?? [];
    const hasRequiredSecrets =
      requiredSecrets.length > 0 && requiredSecrets.every((name) => process.env[name]?.trim());
    const isCredentialGated = fixture.skipReason || (fixture.requiresSecrets?.length ?? 0) > 0;

    if (!entry) {
      if (isCredentialGated && !hasRequiredSecrets) {
        return {
          componentId,
          tier: fixture.tier,
          status: 'skipped',
          fingerprint,
          rationale: fixture.skipReason ?? 'Missing required secrets',
        };
      }
      return {
        componentId,
        tier: fixture.tier,
        status: 'missing',
        fingerprint,
        rationale: 'No ledger entry',
      };
    }

    const entryMatches = hasMatchingSecurityComponentFingerprint(
      entry,
      componentId,
      fixture,
      fingerprint,
      contract,
    );

    if (isCredentialGated && !hasRequiredSecrets) {
      if (entry.status === 'passed' && entryMatches) {
        return {
          componentId,
          tier: fixture.tier,
          status: 'current',
          fingerprint,
          rationale:
            'Ledger matches fixture fingerprint; required secrets are not currently loaded for rerun.',
          verifiedAt: entry.verifiedAt,
        };
      }

      return {
        componentId,
        tier: fixture.tier,
        status: 'skipped',
        fingerprint,
        rationale:
          entry.status === 'skipped'
            ? (entry.error ?? fixture.skipReason ?? 'Missing required secrets')
            : (fixture.skipReason ?? 'Missing required secrets'),
        verifiedAt: entry.verifiedAt,
      };
    }

    if (!entryMatches) {
      return {
        componentId,
        tier: fixture.tier,
        status: 'stale',
        fingerprint,
        rationale: contract
          ? 'Fixture or component contract fingerprint changed'
          : 'Fixture fingerprint changed',
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

    if (entry.status === 'skipped' && hasRequiredSecrets) {
      return {
        componentId,
        tier: fixture.tier,
        status: 'stale',
        fingerprint,
        rationale:
          'Required secrets are now available; previous skipped audit is no longer sufficient.',
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
      rationale:
        contract && isPreContractSecurityComponentFingerprint(entry, componentId, fixture)
          ? 'Ledger matches legacy pre-contract fixture fingerprint'
          : 'Ledger matches fixture fingerprint',
      verifiedAt: entry.verifiedAt,
    };
  });

  const allCurrent = items.every((item) => item.status === 'current' || item.status === 'skipped');

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

  return [
    `Security component ledger: ${summary.allCurrent ? 'CURRENT' : 'NEEDS ATTENTION'}`,
    ...lines,
  ].join('\n');
}

export function shouldSkipSecurityComponentLiveAudit(options: {
  ledger: SecurityComponentLedger | undefined;
  componentId: SecurityComponentId;
  fingerprint: string;
  force: boolean;
  fixture: SecurityComponentAuditFixture;
  contract?: SecurityComponentContractSnapshot | null;
}): SecurityComponentLedgerEntry | undefined {
  const requiredSecrets = options.fixture.requiresSecrets ?? [];
  const missingRequiredSecrets = requiredSecrets.filter((name) => !process.env[name]?.trim());
  const missingCredentialGate =
    missingRequiredSecrets.length > 0 ||
    (requiredSecrets.length === 0 && options.fixture.skipReason !== undefined);
  const existing = options.ledger?.entries[options.componentId];
  const existingMatches = hasMatchingSecurityComponentFingerprint(
    existing,
    options.componentId,
    options.fixture,
    options.fingerprint,
    options.contract,
  );

  if (missingCredentialGate) {
    if (existingMatches && existing?.status === 'passed') {
      return existing;
    }

    return {
      componentId: options.componentId,
      fingerprint: options.fingerprint,
      tier: options.fixture.tier,
      status: 'skipped',
      error:
        options.fixture.skipReason ??
        `Missing required secrets: ${missingRequiredSecrets.join(', ')}`,
      verifiedAt: new Date().toISOString(),
    };
  }

  if (options.force) {
    return undefined;
  }

  if (existingMatches && existing?.status === 'passed') {
    return existing;
  }

  return undefined;
}
