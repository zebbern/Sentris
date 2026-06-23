import { z } from 'zod';
import {
  ComponentRetryPolicy,
  componentRegistry,
  defineComponent,
  fromHttpResponse,
  generateFindingHash,
  inputs,
  outputs,
  parameters,
  param,
  port,
  analyticsResultSchema,
  type AnalyticsResult,
  type ExecutionContext,
} from '@sentris/component-sdk';

const OSV_API_BASE = 'https://api.osv.dev/v1';

const OSV_ECOSYSTEM_PREFIX_ALIASES = new Map<string, string>([
  ['npm', 'npm'],
  ['pypi', 'PyPI'],
  ['go', 'Go'],
  ['maven', 'Maven'],
  ['packagist', 'Packagist'],
  ['crates.io', 'crates.io'],
  ['cargo', 'crates.io'],
  ['nuget', 'NuGet'],
  ['rubygems', 'RubyGems'],
  ['gem', 'RubyGems'],
  ['hex', 'Hex'],
  ['pub', 'Pub'],
  ['debian', 'Debian'],
  ['alpine', 'Alpine'],
  ['ubuntu', 'Ubuntu'],
  ['android', 'Android'],
  ['linux', 'Linux'],
  ['oss-fuzz', 'OSS-Fuzz'],
  ['conan', 'Conan'],
  ['bitnami', 'Bitnami'],
]);

const severityRank = {
  unknown: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
} as const;

type OsvSeverity = keyof typeof severityRank;
type AnalyticsSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

const normalizedPackageSchema = z.object({
  spec: z.string(),
  name: z.string(),
  version: z.string().nullable(),
  ecosystem: z.string(),
});

const osvReferenceSchema = z.object({
  type: z.string().optional(),
  url: z.string().optional(),
});

const osvFindingSchema = z.object({
  packageSpec: z.string(),
  packageName: z.string().nullable(),
  version: z.string().nullable(),
  id: z.string().nullable(),
  aliases: z.array(z.string()),
  cves: z.array(z.string()),
  isMaliciousPackageRecord: z.boolean(),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'unknown']),
  summary: z.string().nullable(),
  published: z.string().nullable(),
  modified: z.string().nullable(),
  fixedVersions: z.array(z.string()),
  references: z.array(osvReferenceSchema),
});

const summarySchema = z.object({
  packagesChecked: z.number(),
  vulnerablePackages: z.number(),
  findings: z.number(),
  maliciousPackageRecords: z.number(),
  countsBySeverity: z.record(z.string(), z.number()),
});

const inputSchema = inputs({
  packageSpecs: port(
    z
      .array(z.string().min(1))
      .describe('Package names with optional versions, for example lodash@4.17.20.'),
    {
      label: 'Package Specs',
      description:
        'Package names with optional versions. Scoped npm packages are supported, for example @scope/pkg@1.2.3. Prefix a spec with an OSV ecosystem, such as PyPI:django@4.2.7, to mix ecosystems in one batch.',
      connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
    },
  ),
});

const parameterSchema = parameters({
  ecosystem: param(z.string().default('npm').describe('OSV package ecosystem to query.'), {
    label: 'Ecosystem',
    editor: 'text',
    description: 'OSV ecosystem name, for example npm, PyPI, Go, Maven, or crates.io.',
  }),
  severityFloor: param(z.enum(['critical', 'high', 'medium', 'low', 'unknown']).default('medium'), {
    label: 'Severity Floor',
    editor: 'select',
    options: [
      { label: 'Critical', value: 'critical' },
      { label: 'High', value: 'high' },
      { label: 'Medium', value: 'medium' },
      { label: 'Low', value: 'low' },
      { label: 'Unknown', value: 'unknown' },
    ],
    description:
      'Known severities below this level are filtered out. Unknown severities are controlled separately.',
  }),
  hydrateAdvisories: param(
    z.boolean().default(true).describe('Fetch full OSV advisory records for returned IDs.'),
    {
      label: 'Hydrate Advisories',
      editor: 'boolean',
      description:
        'OSV querybatch returns advisory IDs only. Hydration fetches summaries, aliases, references, severities, and fixed versions.',
    },
  ),
  maxAdvisoriesPerPackage: param(
    z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(50)
      .describe('Maximum advisories to process per package.'),
    {
      label: 'Max Advisories Per Package',
      editor: 'number',
      min: 1,
      max: 100,
    },
  ),
  includeUnknownSeverity: param(
    z.boolean().default(true).describe('Keep advisories where OSV does not expose severity.'),
    {
      label: 'Include Unknown Severity',
      editor: 'boolean',
      description:
        'Useful for malicious-package records and ecosystem advisories that do not include CVSS metadata.',
    },
  ),
});

const outputSchema = outputs({
  findings: port(z.array(osvFindingSchema), {
    label: 'Findings',
    description: 'Prioritized OSV advisories for the queried package specs.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  }),
  summary: port(summarySchema, {
    label: 'Summary',
    description: 'Counts by package, severity, and malicious-package record status.',
    connectionType: { kind: 'primitive', name: 'json' },
  }),
  packages: port(z.array(normalizedPackageSchema), {
    label: 'Normalized Packages',
    description: 'Parsed package specs sent to OSV.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  }),
  rawResults: port(z.unknown(), {
    label: 'Raw OSV Results',
    description: 'Raw OSV querybatch response for troubleshooting.',
    allowAny: true,
    reason: 'OSV response shape may evolve and can include pagination tokens.',
    connectionType: { kind: 'primitive', name: 'json' },
  }),
  results: port(z.array(analyticsResultSchema()), {
    label: 'Results',
    description:
      'Analytics-ready findings with scanner, finding_hash, severity, package, and advisory details.',
  }),
});

type NormalizedPackage = z.infer<typeof normalizedPackageSchema>;
type OsvFinding = z.infer<typeof osvFindingSchema>;

interface OsvListedVulnerability {
  id?: string;
  modified?: string;
  [key: string]: unknown;
}

interface OsvQueryBatchResult {
  results?: {
    vulns?: OsvListedVulnerability[];
    next_page_token?: string;
  }[];
}

const osvRetryPolicy: ComponentRetryPolicy = {
  maxAttempts: 3,
  initialIntervalSeconds: 2,
  maximumIntervalSeconds: 30,
  backoffCoefficient: 2.0,
  nonRetryableErrorTypes: ['ValidationError', 'AuthenticationError', 'ConfigurationError'],
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function normalizeSeverity(value: unknown): OsvSeverity {
  const text = String(value ?? '').toLowerCase();
  if (text.includes('critical')) return 'critical';
  if (text.includes('high')) return 'high';
  if (text.includes('moderate') || text.includes('medium')) return 'medium';
  if (text.includes('low')) return 'low';
  return 'unknown';
}

function severityFromCvssVector(value: unknown): OsvSeverity {
  const vector = String(value ?? '').toUpperCase();
  if (!vector.startsWith('CVSS:')) return 'unknown';
  if (
    vector.includes('/AV:N') &&
    vector.includes('/AC:L') &&
    vector.includes('/PR:N') &&
    vector.includes('/UI:N') &&
    vector.includes('/C:H') &&
    vector.includes('/I:H') &&
    vector.includes('/A:H')
  ) {
    return 'critical';
  }
  if (
    vector.includes('/AV:N') &&
    vector.includes('/AC:L') &&
    (vector.includes('/C:H') || vector.includes('/I:H') || vector.includes('/A:H'))
  ) {
    return 'high';
  }
  if (vector.includes('/C:H') || vector.includes('/I:H') || vector.includes('/A:H')) {
    return 'medium';
  }
  if (vector.includes('/C:L') || vector.includes('/I:L') || vector.includes('/A:L')) {
    return 'low';
  }
  return 'unknown';
}

function toAnalyticsSeverity(severity: OsvSeverity): AnalyticsSeverity {
  return severity === 'unknown' ? 'info' : severity;
}

export function parsePackageSpec(spec: string, defaultEcosystem: string): NormalizedPackage | null {
  const trimmed = spec.trim();
  if (!trimmed) return null;
  const prefixMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9_.-]*):(.+)$/);
  const explicitEcosystem = prefixMatch
    ? OSV_ECOSYSTEM_PREFIX_ALIASES.get(prefixMatch[1].trim().toLowerCase())
    : undefined;
  const ecosystem = explicitEcosystem || defaultEcosystem.trim() || 'npm';
  const packageSpec = explicitEcosystem ? prefixMatch?.[2]?.trim() || '' : trimmed;
  if (!packageSpec) return null;

  const versionAt = packageSpec.lastIndexOf('@');
  const hasVersion = versionAt > 0;
  const name = hasVersion ? packageSpec.slice(0, versionAt) : packageSpec;
  const version = hasVersion ? packageSpec.slice(versionAt + 1) : null;

  if (!name.trim()) return null;

  return {
    spec: trimmed,
    name: name.trim(),
    version: version?.trim() || null,
    ecosystem,
  };
}

export function inferOsvSeverity(vuln: unknown): OsvSeverity {
  const record = asRecord(vuln);
  const candidates: OsvSeverity[] = [];
  const databaseSpecific = asRecord(record.database_specific ?? record.databaseSpecific);
  const databaseSeverity = databaseSpecific.severity;
  if (databaseSeverity) candidates.push(normalizeSeverity(databaseSeverity));

  if (Array.isArray(record.severity)) {
    for (const item of record.severity) {
      const severityRecord = asRecord(item);
      candidates.push(normalizeSeverity(severityRecord.score));
      candidates.push(severityFromCvssVector(severityRecord.score));
    }
  }

  return candidates.sort((a, b) => severityRank[b] - severityRank[a])[0] ?? 'unknown';
}

export function extractFixedVersions(vuln: unknown): string[] {
  const fixedVersions = new Set<string>();
  const record = asRecord(vuln);
  const affected = Array.isArray(record.affected) ? record.affected : [];

  for (const affectedItem of affected) {
    const affectedRecord = asRecord(affectedItem);
    const ranges = Array.isArray(affectedRecord.ranges) ? affectedRecord.ranges : [];
    for (const range of ranges) {
      const rangeRecord = asRecord(range);
      const events = Array.isArray(rangeRecord.events) ? rangeRecord.events : [];
      for (const event of events) {
        const fixed = asRecord(event).fixed;
        if (typeof fixed === 'string' && fixed.trim().length > 0) {
          fixedVersions.add(fixed.trim());
        }
      }
    }
  }

  return Array.from(fixedVersions);
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item)).filter((item) => item.length > 0)
    : [];
}

function getReferences(value: unknown): { type?: string; url?: string }[] {
  return Array.isArray(value)
    ? value.slice(0, 8).map((item) => {
        const reference = asRecord(item);
        return {
          type: typeof reference.type === 'string' ? reference.type : undefined,
          url: typeof reference.url === 'string' ? reference.url : undefined,
        };
      })
    : [];
}

function buildFinding(
  listedVuln: OsvListedVulnerability,
  hydratedVuln: unknown,
  pkg: NormalizedPackage,
): OsvFinding {
  const vuln = asRecord(hydratedVuln);
  const aliases = getStringArray(vuln.aliases);
  const id =
    typeof vuln.id === 'string'
      ? vuln.id
      : typeof listedVuln.id === 'string'
        ? listedVuln.id
        : null;

  return {
    packageSpec: pkg.spec,
    packageName: pkg.name,
    version: pkg.version,
    id,
    aliases,
    cves: aliases.filter((alias) => alias.startsWith('CVE-')),
    isMaliciousPackageRecord:
      String(id ?? '').startsWith('MAL-') || aliases.some((alias) => alias.startsWith('MAL-')),
    severity: inferOsvSeverity(vuln),
    summary: typeof vuln.summary === 'string' ? vuln.summary : null,
    published: typeof vuln.published === 'string' ? vuln.published : null,
    modified:
      typeof vuln.modified === 'string'
        ? vuln.modified
        : typeof listedVuln.modified === 'string'
          ? listedVuln.modified
          : null,
    fixedVersions: extractFixedVersions(vuln),
    references: getReferences(vuln.references),
  };
}

type HttpFetchContext = Pick<ExecutionContext, 'http'>;

async function fetchJson(
  context: HttpFetchContext,
  url: string,
  init?: RequestInit,
): Promise<unknown> {
  const response = await context.http.fetch(url, init);
  if (!response.ok) {
    const text = await response.text();
    throw fromHttpResponse(response, text);
  }
  return response.json();
}

const definition = defineComponent({
  id: 'sentris.osv.query',
  label: 'OSV Dependency Advisory Query',
  category: 'security',
  runner: { kind: 'inline' },
  retryPolicy: osvRetryPolicy,
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Query OSV.dev for known package vulnerabilities and malicious-package advisories. Supports package/version specs, per-spec ecosystem prefixes, advisory hydration, severity filtering, and analytics-ready output.',
  toolProvider: {
    kind: 'component',
    name: 'osv_dependency_query',
    description: 'Package vulnerability and malicious advisory lookup using OSV.dev.',
  },
  ui: {
    slug: 'osv-query',
    version: '1.0.0',
    type: 'scan',
    category: 'security',
    description:
      'Check package/version specs against OSV.dev and return CVEs, fixed versions, references, and analytics-ready findings.',
    documentationUrl: 'https://google.github.io/osv.dev/api/',
    icon: 'Shield',
    author: {
      name: 'SentrisAI',
      type: 'sentris',
    },
    isLatest: true,
    deprecated: false,
    examples: [
      'Check npm package versions such as lodash@4.17.20 and minimist@0.0.8.',
      'Mix ecosystems in one batch with specs such as npm:lodash@4.17.20 and PyPI:django@4.2.7.',
      'Look up malicious-package advisories for dependency triage.',
    ],
  },
  async execute({ inputs, params }, context) {
    const parsedParams = parameterSchema.parse(params);
    const packages = inputs.packageSpecs
      .map((spec) => parsePackageSpec(spec, parsedParams.ecosystem))
      .filter((pkg): pkg is NormalizedPackage => Boolean(pkg));

    if (packages.length === 0) {
      context.logger.info('[OSV] No package specs provided, returning empty advisory results');
      return {
        findings: [],
        summary: {
          packagesChecked: 0,
          vulnerablePackages: 0,
          findings: 0,
          maliciousPackageRecords: 0,
          countsBySeverity: {},
        },
        packages: [],
        rawResults: { results: [] },
        results: [],
      };
    }

    context.logger.info(`[OSV] Querying ${packages.length} package(s)`);
    context.emitProgress({
      message: `Querying OSV for ${packages.length} package(s)`,
      level: 'info',
    });

    const rawResults = (await fetchJson(context, `${OSV_API_BASE}/querybatch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        queries: packages.map((pkg) => ({
          package: {
            name: pkg.name,
            ecosystem: pkg.ecosystem,
          },
          ...(pkg.version ? { version: pkg.version } : {}),
        })),
      }),
    })) as OsvQueryBatchResult;

    const results = Array.isArray(rawResults.results) ? rawResults.results : [];
    const hydratedCache = new Map<string, unknown>();
    const findings: OsvFinding[] = [];

    for (let index = 0; index < results.length; index++) {
      const result = results[index];
      const pkg = packages[index];
      if (!pkg) continue;

      const listedVulns = Array.isArray(result.vulns)
        ? result.vulns.slice(0, parsedParams.maxAdvisoriesPerPackage)
        : [];

      for (const listedVuln of listedVulns) {
        let advisory: unknown = listedVuln;
        const advisoryId = typeof listedVuln.id === 'string' ? listedVuln.id : '';

        if (parsedParams.hydrateAdvisories && advisoryId.length > 0) {
          if (hydratedCache.has(advisoryId)) {
            advisory = hydratedCache.get(advisoryId);
          } else {
            try {
              advisory = await fetchJson(
                context,
                `${OSV_API_BASE}/vulns/${encodeURIComponent(advisoryId)}`,
                {
                  method: 'GET',
                  headers: { Accept: 'application/json' },
                },
              );
              hydratedCache.set(advisoryId, advisory);
            } catch (error) {
              context.logger.warn(
                `[OSV] Failed to hydrate ${advisoryId}: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
            }
          }
        }

        const finding = buildFinding(listedVuln, advisory, pkg);
        if (finding.severity === 'unknown' && !parsedParams.includeUnknownSeverity) continue;
        if (
          finding.severity !== 'unknown' &&
          severityRank[finding.severity] < severityRank[parsedParams.severityFloor]
        ) {
          continue;
        }
        findings.push(finding);
      }
    }

    findings.sort(
      (a, b) =>
        severityRank[b.severity] - severityRank[a.severity] ||
        String(b.modified ?? '').localeCompare(String(a.modified ?? '')),
    );

    const countsBySeverity = findings.reduce<Record<string, number>>((acc, finding) => {
      acc[finding.severity] = (acc[finding.severity] ?? 0) + 1;
      return acc;
    }, {});

    const vulnerablePackages = new Set(findings.map((finding) => finding.packageSpec));
    const summary = {
      packagesChecked: packages.length,
      vulnerablePackages: vulnerablePackages.size,
      findings: findings.length,
      maliciousPackageRecords: findings.filter((finding) => finding.isMaliciousPackageRecord)
        .length,
      countsBySeverity,
    };

    const analyticsResults: AnalyticsResult[] = findings.map((finding) => ({
      scanner: 'osv',
      finding_hash: generateFindingHash(
        finding.id ?? 'unknown-osv-advisory',
        finding.packageSpec,
        finding.version ?? '',
      ),
      severity: toAnalyticsSeverity(finding.severity),
      asset_key: finding.packageSpec,
      vulnerability_id: finding.id ?? undefined,
      package_name: finding.packageName ?? undefined,
      installed_version: finding.version ?? undefined,
      fixed_versions: finding.fixedVersions,
      aliases: finding.aliases,
      cves: finding.cves,
      title: finding.summary ?? undefined,
      malicious_package_record: finding.isMaliciousPackageRecord,
    }));

    context.logger.info(`[OSV] Found ${findings.length} advisory finding(s)`);

    return {
      findings,
      summary,
      packages,
      rawResults,
      results: analyticsResults,
    };
  },
});

componentRegistry.register(definition);

type OsvInput = typeof inputSchema;
type OsvOutput = typeof outputSchema;

export type { OsvInput, OsvOutput };
export { definition };
