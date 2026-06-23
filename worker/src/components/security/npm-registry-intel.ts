import { z } from 'zod';
import {
  ComponentRetryPolicy,
  componentRegistry,
  defineComponent,
  inputs,
  outputs,
  parameters,
  param,
  port,
  type ExecutionContext,
} from '@sentris/component-sdk';

const NPM_REGISTRY_BASE = 'https://registry.npmjs.org';
const LIFECYCLE_SCRIPT_NAMES = ['preinstall', 'install', 'postinstall'] as const;

const normalizedNpmPackageSchema = z.object({
  spec: z.string(),
  name: z.string(),
  version: z.string().nullable(),
});

const npmMaintainerSchema = z.object({
  name: z.string().nullable(),
  email: z.string().nullable().optional(),
});

const npmRegistryRecordSchema = z.object({
  requestedSpec: z.string(),
  name: z.string(),
  requestedVersion: z.string().nullable(),
  latest: z.string().nullable(),
  analyzedVersion: z.string().nullable(),
  description: z.string().nullable(),
  repositoryUrl: z.string().nullable(),
  homepage: z.string().nullable(),
  license: z.string().nullable(),
  deprecated: z.string().nullable(),
  publishTime: z.string().nullable(),
  createdTime: z.string().nullable(),
  modifiedTime: z.string().nullable(),
  maintainers: z.array(npmMaintainerSchema),
  installScripts: z.array(z.string()),
  dependencyCount: z.number(),
  rawMetadata: z.unknown().optional(),
});

const npmRiskSignalSchema = z.object({
  packageName: z.string(),
  packageSpec: z.string(),
  version: z.string().nullable(),
  signal: z.enum([
    'install-script',
    'deprecated',
    'missing-repository',
    'recent-publish',
    'typosquat-similarity',
  ]),
  severity: z.enum(['high', 'medium', 'low']),
  score: z.number(),
  rationale: z.string(),
  evidence: z.record(z.string(), z.unknown()),
});

const npmSummarySchema = z.object({
  packagesChecked: z.number(),
  recordsFetched: z.number(),
  warnings: z.number(),
  packagesWithSignals: z.number(),
  riskSignals: z.number(),
  countsBySeverity: z.record(z.string(), z.number()),
});

const inputSchema = inputs({
  packageSpecs: port(
    z
      .array(z.string().min(1))
      .describe('npm package names or package@version specs to inspect.'),
    {
      label: 'Package Specs',
      description:
        'npm package names with optional versions. Scoped packages are supported, for example @scope/pkg@1.2.3.',
      connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
    },
  ),
  typosquatCandidates: port(
    z.array(z.string().min(1)).optional().default([]).describe('Trusted names to compare against.'),
    {
      label: 'Typosquat Comparison Names',
      description:
        'Optional trusted package names, internal names, or popular package names used for simple similarity signals.',
      connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
    },
  ),
});

const parameterSchema = parameters({
  maxPackages: param(
    z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(25)
      .describe('Maximum unique npm packages to fetch from the registry.'),
    {
      label: 'Max Packages',
      editor: 'number',
      min: 1,
      max: 100,
      description: 'Caps registry calls for large dependency lists.',
    },
  ),
  recentPublishDays: param(
    z
      .number()
      .int()
      .min(1)
      .max(365)
      .default(30)
      .describe('Flag latest publishes newer than this many days.'),
    {
      label: 'Recent Publish Window',
      editor: 'number',
      min: 1,
      max: 365,
    },
  ),
  includeRawMetadata: param(
    z.boolean().default(false).describe('Attach bounded raw package metadata to each record.'),
    {
      label: 'Include Raw Metadata',
      editor: 'boolean',
      description:
        'Useful for debugging. Disabled by default to keep workflow outputs small and shareable.',
    },
  ),
});

const outputSchema = outputs({
  records: port(z.array(npmRegistryRecordSchema), {
    label: 'Registry Records',
    description: 'Normalized npm registry metadata for each fetched package.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  }),
  riskSignals: port(z.array(npmRiskSignalSchema), {
    label: 'Risk Signals',
    description: 'Rankable supply-chain precursor signals derived from npm registry metadata.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  }),
  summary: port(npmSummarySchema, {
    label: 'Summary',
    description: 'Counts for fetched records, warnings, and emitted risk signals.',
    connectionType: { kind: 'primitive', name: 'json' },
  }),
  packages: port(z.array(normalizedNpmPackageSchema), {
    label: 'Normalized Packages',
    description: 'Parsed npm package specs used for registry lookup.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  }),
  warnings: port(z.array(z.string()), {
    label: 'Warnings',
    description: 'Recoverable registry lookup warnings.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
  }),
});

export type NpmRegistryIntelInput = z.infer<typeof inputSchema>;
export type NpmRegistryIntelOutput = z.infer<typeof outputSchema>;
type NormalizedNpmPackage = z.infer<typeof normalizedNpmPackageSchema>;
type NpmRegistryRecord = z.infer<typeof npmRegistryRecordSchema>;
type NpmRiskSignal = z.infer<typeof npmRiskSignalSchema>;

const npmRegistryRetryPolicy: ComponentRetryPolicy = {
  maxAttempts: 3,
  initialIntervalSeconds: 2,
  maximumIntervalSeconds: 30,
  backoffCoefficient: 2,
  nonRetryableErrorTypes: ['ValidationError'],
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseNpmPackageSpec(spec: string): NormalizedNpmPackage | null {
  const trimmed = spec.trim();
  if (!trimmed) return null;
  const normalized = trimmed.startsWith('npm:') ? trimmed.slice(4).trim() : trimmed;
  if (!normalized) return null;

  const versionAt = normalized.lastIndexOf('@');
  const hasVersion = versionAt > 0;
  const name = hasVersion ? normalized.slice(0, versionAt) : normalized;
  const version = hasVersion ? normalized.slice(versionAt + 1).trim() : null;
  if (!name.trim()) return null;

  return {
    spec: trimmed,
    name: name.trim(),
    version: version || null,
  };
}

function uniquePackages(specs: string[], maxPackages: number): NormalizedNpmPackage[] {
  const byName = new Map<string, NormalizedNpmPackage>();
  for (const spec of specs) {
    const parsed = parseNpmPackageSpec(String(spec));
    if (!parsed || byName.has(parsed.name)) continue;
    byName.set(parsed.name, parsed);
    if (byName.size >= maxPackages) break;
  }
  return [...byName.values()];
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function repositoryUrl(value: unknown): string | null {
  if (typeof value === 'string') return stringValue(value);
  const record = asRecord(value);
  return stringValue(record.url);
}

function maintainerRecords(value: unknown): NpmRegistryRecord['maintainers'] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).map((item) => {
    const record = asRecord(item);
    return {
      name: stringValue(record.name),
      ...(stringValue(record.email) ? { email: stringValue(record.email) } : {}),
    };
  });
}

function normalizedName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = Array.from({ length: right.length + 1 }, () => 0);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        current[rightIndex - 1] + 1,
        previous[rightIndex - 1] + substitutionCost,
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length] ?? 0;
}

function hasTyposquatSimilarity(name: string, candidates: string[]): string | null {
  const normalized = normalizedName(name);
  if (!normalized) return null;

  for (const candidate of candidates) {
    if (candidate === name) continue;
    const normalizedCandidate = normalizedName(candidate);
    if (!normalizedCandidate) continue;
    if (normalizedCandidate.includes(normalized) || normalized.includes(normalizedCandidate)) {
      return candidate;
    }
    const distance = editDistance(normalized, normalizedCandidate);
    if (distance <= 3 && Math.abs(normalized.length - normalizedCandidate.length) <= 4) {
      return candidate;
    }
  }

  return null;
}

function daysSince(value: string | null, nowMs = Date.now()): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, (nowMs - parsed) / 86_400_000);
}

function toRegistryRecord(
  pkg: NormalizedNpmPackage,
  metadata: Record<string, unknown>,
  includeRawMetadata: boolean,
): NpmRegistryRecord {
  const versions = asRecord(metadata.versions);
  const distTags = asRecord(metadata['dist-tags']);
  const latest = stringValue(distTags.latest);
  const analyzedVersion = pkg.version ?? latest;
  const latestMeta = analyzedVersion ? asRecord(versions[analyzedVersion]) : {};
  const scripts = asRecord(latestMeta.scripts);
  const installScripts = LIFECYCLE_SCRIPT_NAMES.filter((name) => stringValue(scripts[name]));
  const dependencies = asRecord(latestMeta.dependencies);
  const time = asRecord(metadata.time);

  return {
    requestedSpec: pkg.spec,
    name: stringValue(metadata.name) ?? pkg.name,
    requestedVersion: pkg.version,
    latest,
    analyzedVersion,
    description: stringValue(metadata.description),
    repositoryUrl: repositoryUrl(latestMeta.repository ?? metadata.repository),
    homepage: stringValue(latestMeta.homepage ?? metadata.homepage),
    license: stringValue(latestMeta.license ?? metadata.license),
    deprecated: stringValue(latestMeta.deprecated),
    publishTime: analyzedVersion ? stringValue(time[analyzedVersion]) : null,
    createdTime: stringValue(time.created),
    modifiedTime: stringValue(time.modified),
    maintainers: maintainerRecords(metadata.maintainers),
    installScripts,
    dependencyCount: Object.keys(dependencies).length,
    ...(includeRawMetadata
      ? {
          rawMetadata: {
            name: metadata.name,
            description: metadata.description,
            'dist-tags': metadata['dist-tags'],
            time: metadata.time,
          },
        }
      : {}),
  };
}

function addSignal(
  signals: NpmRiskSignal[],
  record: NpmRegistryRecord,
  signal: NpmRiskSignal['signal'],
  severity: NpmRiskSignal['severity'],
  score: number,
  rationale: string,
  evidence: Record<string, unknown>,
): void {
  signals.push({
    packageName: record.name,
    packageSpec: record.requestedSpec,
    version: record.analyzedVersion,
    signal,
    severity,
    score,
    rationale,
    evidence,
  });
}

function deriveRiskSignals(
  records: NpmRegistryRecord[],
  typosquatCandidates: string[],
  recentPublishDays: number,
): NpmRiskSignal[] {
  const signals: NpmRiskSignal[] = [];
  const comparisonNames = Array.from(
    new Set([...records.map((record) => record.name), ...typosquatCandidates]),
  );

  for (const record of records) {
    if (record.installScripts.length > 0) {
      addSignal(
        signals,
        record,
        'install-script',
        'high',
        45,
        `Lifecycle install script present: ${record.installScripts.join(', ')}`,
        { installScripts: record.installScripts },
      );
    }

    if (record.deprecated) {
      addSignal(signals, record, 'deprecated', 'medium', 25, 'Package version is deprecated.', {
        deprecated: record.deprecated,
      });
    }

    if (!record.repositoryUrl) {
      addSignal(
        signals,
        record,
        'missing-repository',
        'medium',
        20,
        'Package metadata has no repository URL.',
        {},
      );
    }

    const ageDays = daysSince(record.publishTime);
    if (ageDays !== null && ageDays <= recentPublishDays) {
      addSignal(
        signals,
        record,
        'recent-publish',
        'low',
        15,
        `Analyzed version was published within ${recentPublishDays} days.`,
        { ageDays: Math.round(ageDays * 10) / 10, publishTime: record.publishTime },
      );
    }

    const similarTo = hasTyposquatSimilarity(record.name, comparisonNames);
    if (similarTo) {
      addSignal(
        signals,
        record,
        'typosquat-similarity',
        'medium',
        25,
        `Package name is similar to ${similarTo}.`,
        { similarTo },
      );
    }
  }

  return signals.sort((a, b) => b.score - a.score || a.packageName.localeCompare(b.packageName));
}

async function fetchPackageMetadata(
  context: ExecutionContext,
  packageName: string,
): Promise<Response> {
  const url = `${NPM_REGISTRY_BASE}/${encodeURIComponent(packageName)}`;
  return await context.http.fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'User-Agent': 'SentrisFlow-NpmRegistryIntel',
    },
  });
}

function summarize(records: NpmRegistryRecord[], signals: NpmRiskSignal[], warnings: string[]) {
  const countsBySeverity: Record<string, number> = {};
  for (const signal of signals) {
    countsBySeverity[signal.severity] = (countsBySeverity[signal.severity] ?? 0) + 1;
  }

  return {
    packagesChecked: records.length + warnings.length,
    recordsFetched: records.length,
    warnings: warnings.length,
    packagesWithSignals: new Set(signals.map((signal) => signal.packageName)).size,
    riskSignals: signals.length,
    countsBySeverity,
  };
}

const definition = defineComponent({
  id: 'sentris.npm.registry.intel',
  label: 'NPM Registry Intel',
  category: 'security',
  runner: { kind: 'inline' },
  retryPolicy: npmRegistryRetryPolicy,
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Fetch npm registry package metadata and emit supply-chain precursor signals without executing package code.',
  toolProvider: {
    kind: 'component',
    name: 'npm_registry_intel',
    description:
      'Inspect npm registry metadata for package lifecycle scripts, deprecation, repository gaps, recent publishes, and simple typosquat similarity.',
  },
  ui: {
    slug: 'npm-registry-intel',
    version: '1.0.0',
    type: 'scan',
    category: 'security',
    description: 'Inspect npm package metadata for supply-chain precursor signals.',
    icon: 'PackageSearch',
    author: { name: 'SentrisAI', type: 'sentris' },
    isLatest: true,
    deprecated: false,
  },
  async execute({ inputs, params }, context) {
    const packages = uniquePackages(inputs.packageSpecs, params.maxPackages);
    const warnings: string[] = [];
    const records: NpmRegistryRecord[] = [];

    for (const pkg of packages) {
      try {
        const response = await fetchPackageMetadata(context, pkg.name);
        if (!response.ok) {
          warnings.push(`registry fetch failed for ${pkg.name}: HTTP ${response.status}`);
          continue;
        }
        const metadata = asRecord(await response.json());
        records.push(toRegistryRecord(pkg, metadata, params.includeRawMetadata));
      } catch (error) {
        warnings.push(
          `registry fetch error for ${pkg.name}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    const riskSignals = deriveRiskSignals(
      records,
      inputs.typosquatCandidates ?? [],
      params.recentPublishDays,
    );

    return {
      records,
      riskSignals,
      summary: summarize(records, riskSignals, warnings),
      packages,
      warnings,
    };
  },
});

componentRegistry.register(definition);

export { definition, parseNpmPackageSpec };
