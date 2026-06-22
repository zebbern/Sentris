import { z } from 'zod';
import * as yaml from 'js-yaml';
import {
  componentRegistry,
  defineComponent,
  inputs,
  outputs,
  parameters,
  param,
  port,
  ValidationError,
  type ExecutionContext,
} from '@sentris/component-sdk';

const DEFAULT_MANIFEST_PATHS = [
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'package.json',
  'requirements.txt',
  'pyproject.toml',
  'poetry.lock',
  'Pipfile',
  'Pipfile.lock',
  'composer.json',
  'composer.lock',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
];

const inputSchema = inputs({
  repositoryUrl: port(
    z.string().url().describe('Public GitHub repository URL to inspect for dependency manifests.'),
    {
      label: 'Repository URL',
      description: 'Public GitHub repository URL explicitly authorized for dependency research.',
      connectionType: { kind: 'primitive', name: 'text' },
    },
  ),
  ref: port(z.string().trim().optional().describe('Git ref to read manifests from.'), {
    label: 'Git Ref',
    description:
      'Optional branch, tag, or commit. When omitted, the component resolves the GitHub repository default branch.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  manifestPaths: port(
    z.array(z.string().trim().min(1)).optional().describe('Repository-relative manifest paths.'),
    {
      label: 'Manifest Paths',
      description: 'Optional repository-relative manifest paths. Overrides the default path list.',
      connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
    },
  ),
  includeDevDependencies: port(
    z.boolean().optional().describe('Whether to include top-level dev/test dependencies.'),
    {
      label: 'Include Dev Dependencies',
      description: 'Whether to include top-level dev/test dependencies.',
      connectionType: { kind: 'primitive', name: 'boolean' },
    },
  ),
});

const parameterSchema = parameters({
  ref: param(
    z
      .string()
      .trim()
      .default('main')
      .describe('Fallback Git ref to read manifests from when repository metadata is unavailable.'),
    {
      label: 'Git Ref',
      editor: 'text',
      description:
        'Fallback branch, tag, or commit to read manifests from when no runtime ref is provided and the repository default branch cannot be resolved.',
    },
  ),
  manifestPaths: param(
    z.array(z.string().trim().min(1)).default(DEFAULT_MANIFEST_PATHS).describe('Manifest paths.'),
    {
      label: 'Manifest Paths',
      editor: 'json',
      description: 'Repository-relative manifest paths to fetch.',
    },
  ),
  includeDevDependencies: param(
    z.boolean().default(false).describe('Include top-level dev/test dependencies where available.'),
    {
      label: 'Include Dev Dependencies',
      editor: 'boolean',
      description: 'Include top-level dev/test dependencies in extracted package specs.',
    },
  ),
  maxPackages: param(
    z
      .number()
      .int()
      .min(1)
      .max(500)
      .default(100)
      .describe('Maximum package specs to return per ecosystem.'),
    {
      label: 'Max Packages',
      editor: 'number',
      min: 1,
      max: 500,
    },
  ),
});

const manifestRecordSchema = z.object({
  path: z.string(),
  ecosystem: z.string(),
  status: z.number(),
  packageCount: z.number(),
  excludedDevDependencyCount: z.number().optional(),
  missingExactVersions: z.array(z.string()).optional(),
  error: z.string().optional(),
});

const summarySchema = z.object({
  repository: z.string(),
  owner: z.string(),
  repo: z.string(),
  ref: z.string(),
  manifestsFetched: z.number(),
  manifestsFound: z.number(),
  npmPackages: z.number(),
  pypiPackages: z.number(),
  goPackages: z.number(),
  mavenPackages: z.number(),
  packagistPackages: z.number(),
  bounded: z.boolean(),
});

const outputSchema = outputs({
  npmPackageSpecs: port(z.array(z.string()), {
    label: 'NPM Package Specs',
    description: 'NPM package specs with optional exact versions for OSV npm queries.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
  }),
  pypiPackageSpecs: port(z.array(z.string()), {
    label: 'PyPI Package Specs',
    description: 'PyPI package specs with optional exact versions for OSV PyPI queries.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
  }),
  goPackageSpecs: port(z.array(z.string()), {
    label: 'Go Package Specs',
    description: 'Go module specs with optional exact versions for OSV Go queries.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
  }),
  mavenPackageSpecs: port(z.array(z.string()), {
    label: 'Maven Package Specs',
    description: 'Maven package specs with optional versions for OSV Maven queries.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
  }),
  packagistPackageSpecs: port(z.array(z.string()), {
    label: 'Packagist Package Specs',
    description: 'Composer/Packagist package specs with optional exact versions for OSV queries.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
  }),
  manifests: port(z.array(manifestRecordSchema), {
    label: 'Manifest Evidence',
    description: 'Fetched manifest evidence and extraction counts.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  }),
  summary: port(summarySchema, {
    label: 'Extraction Summary',
    description: 'Repository and package extraction counts.',
    connectionType: { kind: 'primitive', name: 'json' },
  }),
});

interface RepoContext {
  repository: string;
  owner: string;
  repo: string;
  ref: string;
}

interface ExtractedManifest {
  path: string;
  ecosystem: string;
  packageSpecs: string[];
  lockVersionsByIdentity?: Record<string, string>;
  excludedDevDependencyCount?: number;
  missingExactVersions?: string[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function addUnique(target: string[], value: string | null | undefined): void {
  const text = String(value ?? '').trim();
  if (text && !target.includes(text)) target.push(text);
}

function getPackageIdentity(spec: string): string {
  const text = spec.trim();
  if (!text) return '';

  if (text.startsWith('@')) {
    const scopeSeparator = text.indexOf('/');
    if (scopeSeparator === -1) return text;
    const versionSeparator = text.indexOf('@', scopeSeparator + 1);
    return versionSeparator > -1 ? text.slice(0, versionSeparator) : text;
  }

  const versionSeparator = text.indexOf('@');
  return versionSeparator > 0 ? text.slice(0, versionSeparator) : text;
}

function hasExplicitVersion(spec: string): boolean {
  return getPackageIdentity(spec) !== spec.trim();
}

function addPackageSpec(target: string[], seenByIdentity: Map<string, number>, spec: string): void {
  const text = spec.trim();
  const identity = getPackageIdentity(text);
  if (!identity) return;

  const existingIndex = seenByIdentity.get(identity);
  if (existingIndex === undefined) {
    seenByIdentity.set(identity, target.length);
    target.push(text);
    return;
  }

  const existing = target[existingIndex];
  if (!hasExplicitVersion(existing) && hasExplicitVersion(text)) {
    target[existingIndex] = text;
  }
}

function mergeLockVersions(
  target: Map<string, string>,
  versionsByIdentity: Record<string, string> | undefined,
): void {
  if (!versionsByIdentity) return;
  for (const [identity, version] of Object.entries(versionsByIdentity)) {
    const cleanIdentity = identity.trim();
    const cleanVersion = version.trim();
    if (cleanIdentity && cleanVersion && !target.has(cleanIdentity)) {
      target.set(cleanIdentity, cleanVersion);
    }
  }
}

function applyNpmLockVersions(
  specs: string[],
  lockVersionsByIdentity: Map<string, string>,
): string[] {
  return specs.map((spec) => {
    if (hasExplicitVersion(spec)) return spec;
    const identity = getPackageIdentity(spec);
    const version = lockVersionsByIdentity.get(identity);
    return version ? `${identity}@${version}` : spec;
  });
}

function applyPypiLockVersions(
  specs: string[],
  lockVersionsByIdentity: Map<string, string>,
): string[] {
  return specs.map((spec) => {
    if (hasExplicitVersion(spec)) return spec;
    const identity = getPackageIdentity(spec);
    const version = lockVersionsByIdentity.get(getPypiIdentityKey(identity));
    return version ? `${identity}@${version}` : spec;
  });
}

function getPypiIdentityKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[-_.]+/g, '-');
}

function getPackagistIdentityKey(value: string): string {
  return value.trim().toLowerCase();
}

function applyPackagistLockVersions(
  specs: string[],
  lockVersionsByIdentity: Map<string, string>,
): string[] {
  return specs.map((spec) => {
    if (hasExplicitVersion(spec)) return spec;
    const identity = getPackageIdentity(spec);
    const version = lockVersionsByIdentity.get(getPackagistIdentityKey(identity));
    return version ? `${identity}@${version}` : spec;
  });
}

function coerceBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n'].includes(normalized)) return false;
  }
  return fallback;
}

function cleanRef(value: string): string {
  const text = value.trim() || 'main';
  if (/^https?:\/\//i.test(text) || text.includes('..')) {
    throw new ValidationError('Invalid git ref', {
      fieldErrors: { ref: ['Ref cannot be a URL or contain path traversal'] },
    });
  }
  return text.replace(/^\/+|\/+$/g, '');
}

function parseGitHubRepositoryIdentity(repositoryUrl: string): Omit<RepoContext, 'ref'> {
  const parsed = new URL(repositoryUrl.trim());
  if (parsed.hostname.toLowerCase() !== 'github.com') {
    throw new ValidationError('Only github.com repository URLs are supported', {
      fieldErrors: { repositoryUrl: ['Only github.com repository URLs are supported'] },
    });
  }

  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.length < 2) {
    throw new ValidationError('Repository URL must include owner and repo', {
      fieldErrors: { repositoryUrl: ['Expected https://github.com/<owner>/<repo>'] },
    });
  }

  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, '');
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new ValidationError('Repository owner or repo contains unsupported characters', {
      fieldErrors: { repositoryUrl: ['Owner and repo may contain letters, numbers, _, ., and -'] },
    });
  }

  return {
    repository: `https://github.com/${owner}/${repo}`,
    owner,
    repo,
  };
}

function cleanPath(value: string): string {
  const text = value.trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/^\.\//, '');
  const parts = text.split('/').filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === '..')) {
    throw new ValidationError('Invalid manifest path', {
      fieldErrors: { manifestPaths: ['Manifest paths must be repository-relative'] },
    });
  }
  return parts.join('/');
}

async function resolveEffectiveRef(
  context: Pick<ExecutionContext, 'http'>,
  inputRef: unknown,
  fallbackRef: string,
  owner: string,
  repo: string,
): Promise<string> {
  if (typeof inputRef === 'string' && inputRef.trim().length > 0) {
    return cleanRef(inputRef);
  }

  const metadataUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  try {
    const response = await context.http.fetch(metadataUrl, {
      method: 'GET',
      headers: { Accept: 'application/vnd.github+json, application/json' },
    });
    if (response.ok) {
      const metadata = (await response.json()) as { default_branch?: unknown };
      if (
        typeof metadata.default_branch === 'string' &&
        metadata.default_branch.trim().length > 0
      ) {
        return cleanRef(metadata.default_branch);
      }
    }
  } catch {
    // Fall back to the configured component default when metadata lookup fails.
  }

  return cleanRef(fallbackRef);
}

function encodePath(value: string): string {
  return value
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function buildRawGitHubUrl(repo: RepoContext, path: string): string {
  return `https://raw.githubusercontent.com/${encodeURIComponent(repo.owner)}/${encodeURIComponent(
    repo.repo,
  )}/${encodePath(repo.ref)}/${encodePath(path)}`;
}

function parseJson(raw: string): unknown {
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function namesFrom(section: unknown): string[] {
  return Object.keys(asRecord(section)).filter(
    (name) => name && !name.startsWith('.') && !name.includes(' '),
  );
}

function extractNpmFromLockfile(
  path: string,
  raw: string,
  includeDevDependencies: boolean,
  maxPackages: number,
): ExtractedManifest | null {
  const lockfile = asRecord(parseJson(raw));
  if (Object.keys(lockfile).length === 0) return null;

  const lockPackages = asRecord(lockfile.packages);
  const legacyDependencies = asRecord(lockfile.dependencies);
  if (Object.keys(lockPackages).length === 0 && Object.keys(legacyDependencies).length > 0) {
    const packageSpecs: string[] = [];
    const missingExactVersions: string[] = [];
    let excludedDevDependencyCount = 0;

    for (const name of Object.keys(legacyDependencies).sort()) {
      const dependency = asRecord(legacyDependencies[name]);
      const isDevDependency = dependency.dev === true;
      if (isDevDependency && !includeDevDependencies) {
        excludedDevDependencyCount++;
        continue;
      }

      const version = typeof dependency.version === 'string' ? dependency.version : null;
      if (version) addUnique(packageSpecs, `${name}@${version}`);
      else {
        missingExactVersions.push(name);
        addUnique(packageSpecs, name);
      }
      if (packageSpecs.length >= maxPackages) break;
    }

    return {
      path,
      ecosystem: 'npm',
      packageSpecs,
      excludedDevDependencyCount: includeDevDependencies ? 0 : excludedDevDependencyCount,
      missingExactVersions: Array.from(new Set(missingExactVersions)).slice(0, 40),
    };
  }

  const root = asRecord(lockPackages['']);
  const runtimeNames = Array.from(
    new Set([...namesFrom(root.dependencies), ...namesFrom(root.optionalDependencies)]),
  ).sort();
  const devNames = namesFrom(root.devDependencies).sort();
  const selectedNames = includeDevDependencies
    ? Array.from(new Set([...runtimeNames, ...devNames])).sort()
    : runtimeNames;

  const packageSpecs: string[] = [];
  const missingExactVersions: string[] = [];
  for (const name of selectedNames) {
    const packageEntry = asRecord(lockPackages[`node_modules/${name}`]);
    const legacyEntry = asRecord(asRecord(lockfile.dependencies)[name]);
    const version =
      typeof packageEntry.version === 'string'
        ? packageEntry.version
        : typeof legacyEntry.version === 'string'
          ? legacyEntry.version
          : null;
    if (version) addUnique(packageSpecs, `${name}@${version}`);
    else {
      missingExactVersions.push(name);
      addUnique(packageSpecs, name);
    }
    if (packageSpecs.length >= maxPackages) break;
  }

  return {
    path,
    ecosystem: 'npm',
    packageSpecs,
    excludedDevDependencyCount: includeDevDependencies ? 0 : devNames.length,
    missingExactVersions: Array.from(new Set(missingExactVersions)).slice(0, 40),
  };
}

function extractNpmFromPackageJson(
  path: string,
  raw: string,
  includeDevDependencies: boolean,
  maxPackages: number,
): ExtractedManifest | null {
  const packageJson = asRecord(parseJson(raw));
  if (Object.keys(packageJson).length === 0) return null;

  const names = Array.from(
    new Set([
      ...namesFrom(packageJson.dependencies),
      ...namesFrom(packageJson.optionalDependencies),
      ...(includeDevDependencies ? namesFrom(packageJson.devDependencies) : []),
    ]),
  ).sort();

  return {
    path,
    ecosystem: 'npm',
    packageSpecs: names.slice(0, maxPackages),
    excludedDevDependencyCount: includeDevDependencies
      ? 0
      : namesFrom(packageJson.devDependencies).length,
    missingExactVersions: names.slice(0, maxPackages),
  };
}

function normalizeNpmLockVersion(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/^["']|["']$/g, '');
  if (!text || /^(catalog|file|link|path|portal|workspace):/i.test(text)) return null;

  const npmAlias = text.match(/^npm:(?:@[^/]+\/[^@]+|[^@]+)@(.+)$/);
  const candidate = (npmAlias?.[1] ?? text).split('(')[0]?.trim();
  if (!candidate || candidate.includes(':')) return null;
  return candidate;
}

function readPnpmDependencyVersion(value: unknown): string | null {
  if (typeof value === 'string') return normalizeNpmLockVersion(value);

  const dependency = asRecord(value);
  const version = normalizeNpmLockVersion(dependency.version);
  if (version) return version;

  return normalizeNpmLockVersion(dependency.specifier);
}

function extractPnpmLockfile(
  path: string,
  raw: string,
  includeDevDependencies: boolean,
  maxPackages: number,
): ExtractedManifest | null {
  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch {
    return null;
  }

  const lockfile = asRecord(parsed);
  const importers = asRecord(lockfile.importers);
  const rootImporter = asRecord(importers['.'] ?? importers['']);
  if (Object.keys(rootImporter).length === 0) return null;

  const dependencyEntries = new Map<string, unknown>();
  for (const sectionName of ['dependencies', 'optionalDependencies']) {
    const section = asRecord(rootImporter[sectionName]);
    for (const name of Object.keys(section).sort()) {
      if (!dependencyEntries.has(name)) dependencyEntries.set(name, section[name]);
    }
  }

  const devDependencies = asRecord(rootImporter.devDependencies);
  if (includeDevDependencies) {
    for (const name of Object.keys(devDependencies).sort()) {
      if (!dependencyEntries.has(name)) dependencyEntries.set(name, devDependencies[name]);
    }
  }

  const packageSpecs: string[] = [];
  const missingExactVersions: string[] = [];
  for (const [name, value] of Array.from(dependencyEntries.entries()).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const version = readPnpmDependencyVersion(value);
    if (version) addUnique(packageSpecs, `${name}@${version}`);
    else {
      missingExactVersions.push(name);
      addUnique(packageSpecs, name);
    }
    if (packageSpecs.length >= maxPackages) break;
  }

  return {
    path,
    ecosystem: 'npm',
    packageSpecs,
    excludedDevDependencyCount: includeDevDependencies ? 0 : Object.keys(devDependencies).length,
    missingExactVersions: Array.from(new Set(missingExactVersions)).slice(0, 40),
  };
}

function cleanYarnLockSelector(value: string): string {
  return value.trim().replace(/^["']|["']$/g, '');
}

function getYarnSelectorIdentity(selector: string): string | null {
  const cleanSelector = cleanYarnLockSelector(selector);
  const npmProtocolIndex = cleanSelector.indexOf('@npm:');
  if (npmProtocolIndex > 0) return cleanSelector.slice(0, npmProtocolIndex);

  if (cleanSelector.startsWith('@')) {
    const scopeSeparator = cleanSelector.indexOf('/');
    if (scopeSeparator === -1) return null;
    const versionSeparator = cleanSelector.indexOf('@', scopeSeparator + 1);
    return versionSeparator > -1 ? cleanSelector.slice(0, versionSeparator) : null;
  }

  const versionSeparator = cleanSelector.indexOf('@');
  return versionSeparator > 0 ? cleanSelector.slice(0, versionSeparator) : null;
}

function extractYarnLockfile(path: string, raw: string): ExtractedManifest {
  const lockVersions = new Map<string, string>();
  let currentIdentities: string[] = [];

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    if (!rawLine.startsWith(' ') && line.endsWith(':')) {
      currentIdentities = line
        .slice(0, -1)
        .split(/,\s*/)
        .map(getYarnSelectorIdentity)
        .filter((identity): identity is string => Boolean(identity));
      continue;
    }

    const versionMatch = line.match(/^version:?\s+"?([^"\s]+)"?/);
    if (!versionMatch || currentIdentities.length === 0) continue;

    const version = normalizeNpmLockVersion(versionMatch[1]);
    if (!version) continue;
    for (const identity of currentIdentities) {
      if (!lockVersions.has(identity)) lockVersions.set(identity, version);
    }
  }

  return {
    path,
    ecosystem: 'npm-lock',
    packageSpecs: [],
    lockVersionsByIdentity: Object.fromEntries(lockVersions),
  };
}

function extractPypiRequirements(
  path: string,
  raw: string,
  maxPackages: number,
): ExtractedManifest {
  const packageSpecs: string[] = [];
  const missingExactVersions: string[] = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#') || line.startsWith('-')) continue;
    addPypiDependencySpec(packageSpecs, missingExactVersions, line);
    if (packageSpecs.length >= maxPackages) break;
  }
  return {
    path,
    ecosystem: 'PyPI',
    packageSpecs,
    missingExactVersions: Array.from(new Set(missingExactVersions)).slice(0, 40),
  };
}

function parsePypiRequirement(
  value: string,
): { name: string; spec: string; exact: boolean } | null {
  const line = value
    .replace(/^\s*["']|["']\s*$/g, '')
    .replace(/\s+#.*$/, '')
    .split(';')[0]
    .trim();
  if (!line || line.startsWith('#') || line.startsWith('-')) return null;

  const exactMatch = line.match(/^([A-Za-z0-9_.-]+)(?:\[[^\]]+\])?\s*(==|===)\s*([^;,\s]+)/);
  if (exactMatch) {
    return { name: exactMatch[1], spec: `${exactMatch[1]}@${exactMatch[3]}`, exact: true };
  }

  const name = line.split(/[<>=~!;\s]/)[0]?.trim();
  return name ? { name, spec: name, exact: false } : null;
}

function addPypiDependencySpec(
  packageSpecs: string[],
  missingExactVersions: string[],
  value: string,
): void {
  const parsed = parsePypiRequirement(value);
  if (!parsed) return;
  addUnique(packageSpecs, parsed.spec);
  if (!parsed.exact) addUnique(missingExactVersions, parsed.name);
}

function stripTomlComment(line: string): string {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const previous = line[index - 1];
    if (char === '"' && !inSingleQuote && previous !== '\\') inDoubleQuote = !inDoubleQuote;
    if (char === "'" && !inDoubleQuote) inSingleQuote = !inSingleQuote;
    if (char === '#' && !inSingleQuote && !inDoubleQuote) return line.slice(0, index);
  }
  return line;
}

function unquoteTomlKey(value: string): string {
  return value.trim().replace(/^["']|["']$/g, '');
}

function extractTomlQuotedStrings(value: string): string[] {
  return Array.from(value.matchAll(/"((?:\\"|[^"])*)"|'([^']*)'/g))
    .map((match) => (match[1] ?? match[2] ?? '').replace(/\\"/g, '"').trim())
    .filter(Boolean);
}

function readTomlArrayAssignment(
  lines: string[],
  startIndex: number,
  firstValue: string,
): { values: string[]; nextIndex: number } {
  const chunks = [firstValue];
  let index = startIndex;
  while (!chunks.join('\n').includes(']') && index + 1 < lines.length) {
    index += 1;
    chunks.push(stripTomlComment(lines[index]));
  }

  return {
    values: extractTomlQuotedStrings(chunks.join('\n')),
    nextIndex: index,
  };
}

function extractPyprojectToml(path: string, raw: string, maxPackages: number): ExtractedManifest {
  const packageSpecs: string[] = [];
  const missingExactVersions: string[] = [];
  const lines = raw.split(/\r?\n/);
  let section = '';

  for (let index = 0; index < lines.length; index += 1) {
    const line = stripTomlComment(lines[index]).trim();
    if (!line) continue;

    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1].trim();
      continue;
    }

    if (section === 'project') {
      const dependencyMatch = line.match(/^dependencies\s*=\s*(.+)$/);
      if (!dependencyMatch) continue;
      const arrayAssignment = readTomlArrayAssignment(lines, index, dependencyMatch[1]);
      for (const dependency of arrayAssignment.values) {
        addPypiDependencySpec(packageSpecs, missingExactVersions, dependency);
        if (packageSpecs.length >= maxPackages) break;
      }
      index = arrayAssignment.nextIndex;
      continue;
    }

    if (section === 'tool.poetry.dependencies') {
      const dependencyMatch = line.match(/^([^=\s]+)\s*=\s*(.+)$/);
      if (!dependencyMatch) continue;
      const name = unquoteTomlKey(dependencyMatch[1]);
      if (!name || name.toLowerCase() === 'python') continue;
      const value = dependencyMatch[2].trim();
      if (/\boptional\s*=\s*true\b/i.test(value)) continue;

      const quotedValues = extractTomlQuotedStrings(value);
      const exactVersion = quotedValues.find((item) => item.startsWith('=='))?.slice(2);
      if (exactVersion) addUnique(packageSpecs, `${name}@${exactVersion}`);
      else {
        addUnique(packageSpecs, name);
        addUnique(missingExactVersions, name);
      }
    }

    if (packageSpecs.length >= maxPackages) break;
  }

  return {
    path,
    ecosystem: 'PyPI',
    packageSpecs: packageSpecs
      .slice(0, maxPackages)
      .sort((a, b) => getPackageIdentity(a).localeCompare(getPackageIdentity(b))),
    missingExactVersions: Array.from(new Set(missingExactVersions)).slice(0, 40),
  };
}

function extractPoetryLockfile(path: string, raw: string): ExtractedManifest {
  const lockVersions = new Map<string, string>();
  let currentName: string | null = null;
  let currentVersion: string | null = null;

  function flushPackage(): void {
    if (currentName && currentVersion) {
      lockVersions.set(getPypiIdentityKey(currentName), currentVersion);
    }
    currentName = null;
    currentVersion = null;
  }

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim();
    if (line === '[[package]]') {
      flushPackage();
      continue;
    }

    const nameMatch = line.match(/^name\s*=\s*["']([^"']+)["']/);
    if (nameMatch) {
      currentName = nameMatch[1].trim();
      continue;
    }

    const versionMatch = line.match(/^version\s*=\s*["']([^"']+)["']/);
    if (versionMatch) {
      currentVersion = versionMatch[1].trim();
    }
  }
  flushPackage();

  return {
    path,
    ecosystem: 'PyPI-lock',
    packageSpecs: [],
    lockVersionsByIdentity: Object.fromEntries(lockVersions),
  };
}

function normalizePipfileLockVersion(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  return text.replace(/^(==|===)/, '');
}

function addPipfileDependency(
  packageSpecs: string[],
  missingExactVersions: string[],
  name: string,
  value: string,
): void {
  if (!name || name.toLowerCase() === 'python') return;
  if (/\bskip\s*=\s*true\b/i.test(value)) return;

  const quotedValues = extractTomlQuotedStrings(value);
  const exactVersion =
    quotedValues.find((item) => item.startsWith('=='))?.slice(2) ??
    value.match(/^\s*["']?==([^"',\s}]+)["']?/)?.[1];

  if (exactVersion) addUnique(packageSpecs, `${name}@${exactVersion}`);
  else {
    addUnique(packageSpecs, name);
    addUnique(missingExactVersions, name);
  }
}

function extractPipfile(
  path: string,
  raw: string,
  includeDevDependencies: boolean,
  maxPackages: number,
): ExtractedManifest {
  const packageSpecs: string[] = [];
  const missingExactVersions: string[] = [];
  let excludedDevDependencyCount = 0;
  let section = '';

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim();
    if (!line) continue;

    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1].trim();
      continue;
    }

    if (section !== 'packages' && section !== 'dev-packages') continue;

    const dependencyMatch = line.match(/^([^=\s]+)\s*=\s*(.+)$/);
    if (!dependencyMatch) continue;

    const name = unquoteTomlKey(dependencyMatch[1]);
    if (section === 'dev-packages' && !includeDevDependencies) {
      if (name) excludedDevDependencyCount++;
      continue;
    }

    addPipfileDependency(packageSpecs, missingExactVersions, name, dependencyMatch[2].trim());
    if (packageSpecs.length >= maxPackages) break;
  }

  return {
    path,
    ecosystem: 'PyPI',
    packageSpecs: packageSpecs
      .slice(0, maxPackages)
      .sort((a, b) => getPackageIdentity(a).localeCompare(getPackageIdentity(b))),
    excludedDevDependencyCount: includeDevDependencies ? 0 : excludedDevDependencyCount,
    missingExactVersions: Array.from(new Set(missingExactVersions)).slice(0, 40),
  };
}

function extractPipfileLockfile(
  path: string,
  raw: string,
  includeDevDependencies: boolean,
): ExtractedManifest | null {
  const lockfile = asRecord(parseJson(raw));
  if (Object.keys(lockfile).length === 0) return null;

  const lockVersions = new Map<string, string>();
  const sections = includeDevDependencies ? ['default', 'develop'] : ['default'];
  for (const sectionName of sections) {
    const section = asRecord(lockfile[sectionName]);
    for (const [name, dependency] of Object.entries(section)) {
      const version = normalizePipfileLockVersion(asRecord(dependency).version);
      if (version) lockVersions.set(getPypiIdentityKey(name), version);
    }
  }

  return {
    path,
    ecosystem: 'PyPI-lock',
    packageSpecs: [],
    lockVersionsByIdentity: Object.fromEntries(lockVersions),
  };
}

function isPackagistPackageName(name: string): boolean {
  const text = name.trim();
  if (!text.includes('/')) return false;
  if (/^(php|hhvm|ext-|lib-|composer-plugin-api|composer-runtime-api)$/i.test(text)) return false;
  return /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(text);
}

function normalizeComposerVersion(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text === '*') return null;
  if (/^(?:v)?\d+(?:\.\d+){1,3}(?:[-+][A-Za-z0-9_.-]+)?$/.test(text)) return text;
  return null;
}

function addComposerJsonDependency(
  packageSpecs: string[],
  missingExactVersions: string[],
  name: string,
  constraint: unknown,
): void {
  if (!isPackagistPackageName(name)) return;
  const version = normalizeComposerVersion(constraint);
  if (version) addUnique(packageSpecs, `${name}@${version}`);
  else {
    addUnique(packageSpecs, name);
    addUnique(missingExactVersions, name);
  }
}

function extractComposerJson(
  path: string,
  raw: string,
  includeDevDependencies: boolean,
  maxPackages: number,
): ExtractedManifest | null {
  const composerJson = asRecord(parseJson(raw));
  if (Object.keys(composerJson).length === 0) return null;

  const packageSpecs: string[] = [];
  const missingExactVersions: string[] = [];
  const requireSection = asRecord(composerJson.require);
  const requireDevSection = asRecord(composerJson['require-dev']);
  let excludedDevDependencyCount = 0;

  for (const [name, constraint] of Object.entries(requireSection).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    addComposerJsonDependency(packageSpecs, missingExactVersions, name, constraint);
    if (packageSpecs.length >= maxPackages) break;
  }

  if (includeDevDependencies && packageSpecs.length < maxPackages) {
    for (const [name, constraint] of Object.entries(requireDevSection).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      addComposerJsonDependency(packageSpecs, missingExactVersions, name, constraint);
      if (packageSpecs.length >= maxPackages) break;
    }
  } else {
    excludedDevDependencyCount =
      Object.keys(requireDevSection).filter(isPackagistPackageName).length;
  }

  return {
    path,
    ecosystem: 'Packagist',
    packageSpecs,
    excludedDevDependencyCount: includeDevDependencies ? 0 : excludedDevDependencyCount,
    missingExactVersions: Array.from(new Set(missingExactVersions)).slice(0, 40),
  };
}

function extractComposerLockfile(
  path: string,
  raw: string,
  includeDevDependencies: boolean,
): ExtractedManifest | null {
  const composerLock = asRecord(parseJson(raw));
  if (Object.keys(composerLock).length === 0) return null;

  const lockVersions = new Map<string, string>();
  const sections = includeDevDependencies ? ['packages', 'packages-dev'] : ['packages'];
  for (const sectionName of sections) {
    const section = composerLock[sectionName];
    if (!Array.isArray(section)) continue;
    for (const item of section) {
      const dependency = asRecord(item);
      const name = typeof dependency.name === 'string' ? dependency.name.trim() : '';
      const version = typeof dependency.version === 'string' ? dependency.version.trim() : '';
      if (isPackagistPackageName(name) && version) {
        lockVersions.set(getPackagistIdentityKey(name), version);
      }
    }
  }

  return {
    path,
    ecosystem: 'Packagist-lock',
    packageSpecs: [],
    lockVersionsByIdentity: Object.fromEntries(lockVersions),
  };
}

function extractGoModules(path: string, raw: string, maxPackages: number): ExtractedManifest {
  const packageSpecs: string[] = [];
  let inRequireBlock = false;
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.replace(/\/\/.*$/, '').trim();
    if (!line) continue;
    if (line === 'require (') {
      inRequireBlock = true;
      continue;
    }
    if (inRequireBlock && line === ')') {
      inRequireBlock = false;
      continue;
    }
    const requireText = line.startsWith('require ') ? line.slice('require '.length).trim() : line;
    if (!inRequireBlock && !line.startsWith('require ')) continue;
    const [name, version] = requireText.split(/\s+/);
    if (name && version) addUnique(packageSpecs, `${name}@${version}`);
    if (packageSpecs.length >= maxPackages) break;
  }
  return { path, ecosystem: 'Go', packageSpecs };
}

function readXmlText(block: string, tagName: string): string | null {
  const match = block.match(new RegExp(`<${tagName}>\\s*([^<\\s][^<]*?)\\s*</${tagName}>`));
  return match?.[1]?.trim() || null;
}

function extractMavenProperties(raw: string): Map<string, string> {
  const properties = new Map<string, string>();
  const propertiesBlock = raw.match(/<properties>([\s\S]*?)<\/properties>/)?.[1] ?? '';
  const propertyMatches = propertiesBlock.matchAll(
    /<([A-Za-z0-9_.-]+)>\s*([^<\s][^<]*?)\s*<\/\1>/g,
  );
  for (const property of propertyMatches) {
    const key = property[1]?.trim();
    const value = property[2]?.trim();
    if (key && value && !value.includes('${')) properties.set(key, value);
  }
  return properties;
}

function resolveMavenProperty(
  value: string | null,
  properties: Map<string, string>,
): string | null {
  if (!value) return null;
  const placeholder = value.match(/^\$\{([^}]+)\}$/)?.[1]?.trim();
  if (!placeholder) return value;
  return properties.get(placeholder) ?? null;
}

function mavenIdentity(groupId: string | null, artifactId: string | null): string | null {
  return groupId && artifactId ? `${groupId}:${artifactId}` : null;
}

function extractMavenDependencyManagementVersions(
  raw: string,
  properties: Map<string, string>,
): Map<string, string> {
  const managedVersions = new Map<string, string>();
  const managementBlocks = raw.matchAll(
    /<dependencyManagement>([\s\S]*?)<\/dependencyManagement>/g,
  );

  for (const managementBlock of managementBlocks) {
    const dependencyMatches = managementBlock[1].matchAll(/<dependency>([\s\S]*?)<\/dependency>/g);
    for (const dependency of dependencyMatches) {
      const block = dependency[1];
      const identity = mavenIdentity(
        readXmlText(block, 'groupId'),
        readXmlText(block, 'artifactId'),
      );
      const version = resolveMavenProperty(readXmlText(block, 'version'), properties);
      if (identity && version) managedVersions.set(identity, version);
    }
  }

  return managedVersions;
}

function extractMavenPom(
  path: string,
  raw: string,
  includeDevDependencies: boolean,
  maxPackages: number,
): ExtractedManifest {
  const packageSpecs: string[] = [];
  const missingExactVersions: string[] = [];
  let excludedDevDependencyCount = 0;
  const properties = extractMavenProperties(raw);
  const managedVersions = extractMavenDependencyManagementVersions(raw, properties);
  const directDependencies = raw.replace(
    /<dependencyManagement>[\s\S]*?<\/dependencyManagement>/g,
    '',
  );
  const dependencyMatches = directDependencies.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g);
  for (const dependency of dependencyMatches) {
    const block = dependency[1];
    const scope = readXmlText(block, 'scope')?.toLowerCase();
    if (scope === 'test' && !includeDevDependencies) {
      excludedDevDependencyCount++;
      continue;
    }

    const groupId = readXmlText(block, 'groupId');
    const artifactId = readXmlText(block, 'artifactId');
    const identity = mavenIdentity(groupId, artifactId);
    if (identity) {
      const version =
        resolveMavenProperty(readXmlText(block, 'version'), properties) ??
        managedVersions.get(identity);
      if (version) addUnique(packageSpecs, `${identity}@${version}`);
      else {
        missingExactVersions.push(identity);
        addUnique(packageSpecs, identity);
      }
    }
    if (packageSpecs.length >= maxPackages) break;
  }
  return {
    path,
    ecosystem: 'Maven',
    packageSpecs,
    excludedDevDependencyCount: includeDevDependencies ? 0 : excludedDevDependencyCount,
    missingExactVersions: Array.from(new Set(missingExactVersions)).slice(0, 40),
  };
}

function isGradleDevDependencyConfiguration(configuration: string): boolean {
  return configuration.toLowerCase().includes('test');
}

function parseGradleStringDependency(line: string): {
  configuration: string;
  groupId: string;
  artifactId: string;
  version: string | null;
} | null {
  const match = line.match(
    /^\s*([A-Za-z][A-Za-z0-9_]*)\s*(?:\(\s*)?["']([^:"']+):([^:"']+)(?::([^"']+))?["']\s*\)?/,
  );
  if (!match) return null;

  return {
    configuration: match[1],
    groupId: match[2],
    artifactId: match[3],
    version: match[4]?.trim() || null,
  };
}

function readGradleNamedValue(line: string, key: string): string | null {
  const match = line.match(new RegExp(`(?:^|[,(\\s])${key}\\s*(?::|=)\\s*["']([^"']+)["']`));
  return match?.[1]?.trim() || null;
}

function parseGradleMapDependency(line: string): {
  configuration: string;
  groupId: string;
  artifactId: string;
  version: string | null;
} | null {
  const configuration = line.match(/^\s*([A-Za-z][A-Za-z0-9_]*)\s*(?:\(|\s)/)?.[1];
  if (!configuration) return null;

  const groupId = readGradleNamedValue(line, 'group');
  const artifactId = readGradleNamedValue(line, 'name');
  if (!groupId || !artifactId) return null;

  return {
    configuration,
    groupId,
    artifactId,
    version: readGradleNamedValue(line, 'version'),
  };
}

function extractGradleBuild(
  path: string,
  raw: string,
  includeDevDependencies: boolean,
  maxPackages: number,
): ExtractedManifest {
  const packageSpecs: string[] = [];
  const missingExactVersions: string[] = [];
  let excludedDevDependencyCount = 0;

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.replace(/\/\/.*$/, '').trim();
    if (!line) continue;

    const dependency = parseGradleStringDependency(line) ?? parseGradleMapDependency(line);
    if (!dependency) continue;

    if (isGradleDevDependencyConfiguration(dependency.configuration) && !includeDevDependencies) {
      excludedDevDependencyCount++;
      continue;
    }

    const identity = `${dependency.groupId}:${dependency.artifactId}`;
    if (dependency.version) addUnique(packageSpecs, `${identity}@${dependency.version}`);
    else {
      missingExactVersions.push(identity);
      addUnique(packageSpecs, identity);
    }

    if (packageSpecs.length >= maxPackages) break;
  }

  return {
    path,
    ecosystem: 'Gradle',
    packageSpecs,
    excludedDevDependencyCount: includeDevDependencies ? 0 : excludedDevDependencyCount,
    missingExactVersions: Array.from(new Set(missingExactVersions)).slice(0, 40),
  };
}

function extractManifest(
  path: string,
  raw: string,
  includeDevDependencies: boolean,
  maxPackages: number,
): ExtractedManifest | null {
  const file = path.toLowerCase().split('/').pop() ?? path.toLowerCase();
  if (file === 'package-lock.json') {
    return extractNpmFromLockfile(path, raw, includeDevDependencies, maxPackages);
  }
  if (file === 'pnpm-lock.yaml') {
    return extractPnpmLockfile(path, raw, includeDevDependencies, maxPackages);
  }
  if (file === 'yarn.lock') {
    return extractYarnLockfile(path, raw);
  }
  if (file === 'package.json') {
    return extractNpmFromPackageJson(path, raw, includeDevDependencies, maxPackages);
  }
  if (file === 'requirements.txt') {
    return extractPypiRequirements(path, raw, maxPackages);
  }
  if (file === 'pyproject.toml') {
    return extractPyprojectToml(path, raw, maxPackages);
  }
  if (file === 'poetry.lock') {
    return extractPoetryLockfile(path, raw);
  }
  if (file === 'pipfile') {
    return extractPipfile(path, raw, includeDevDependencies, maxPackages);
  }
  if (file === 'pipfile.lock') {
    return extractPipfileLockfile(path, raw, includeDevDependencies);
  }
  if (file === 'composer.json') {
    return extractComposerJson(path, raw, includeDevDependencies, maxPackages);
  }
  if (file === 'composer.lock') {
    return extractComposerLockfile(path, raw, includeDevDependencies);
  }
  if (file === 'go.mod') {
    return extractGoModules(path, raw, maxPackages);
  }
  if (file === 'pom.xml') {
    return extractMavenPom(path, raw, includeDevDependencies, maxPackages);
  }
  if (file === 'build.gradle' || file === 'build.gradle.kts') {
    return extractGradleBuild(path, raw, includeDevDependencies, maxPackages);
  }
  return null;
}

async function fetchRawManifest(
  context: Pick<ExecutionContext, 'http'>,
  url: string,
): Promise<{ status: number; raw: string; error?: string }> {
  try {
    const response = await context.http.fetch(url, {
      method: 'GET',
      headers: { Accept: 'text/plain, application/json, application/xml, text/xml, */*' },
    });
    return {
      status: response.status,
      raw: await response.text(),
    };
  } catch (error) {
    return {
      status: 0,
      raw: '',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const definition = defineComponent({
  id: 'sentris.repository.manifest.extract',
  label: 'Repository Manifest Extractor',
  category: 'security',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Fetch common dependency manifests from a public GitHub repository and extract ecosystem-specific package specs for OSV queries.',
  toolProvider: {
    kind: 'component',
    name: 'repository_manifest_extract',
    description: 'Extract package specs from public GitHub repository manifests.',
  },
  ui: {
    slug: 'repository-manifest-extractor',
    version: '1.0.0',
    type: 'process',
    category: 'security',
    description:
      'Extract npm, PyPI, Go, and Maven package specs from authorized public GitHub repositories.',
    documentationUrl: 'https://osv.dev/docs/',
    icon: 'PackageSearch',
    author: {
      name: 'SentrisAI',
      type: 'sentris',
    },
    isLatest: true,
    deprecated: false,
    examples: [
      'Extract package-lock.json direct dependencies from an npm repository.',
      'Extract requirements.txt and go.mod package specs for OSV dependency research.',
    ],
  },
  async execute({ inputs, params }, context) {
    const parsedParams = parameterSchema.parse(params);
    const effectiveManifestPaths =
      Array.isArray(inputs.manifestPaths) && inputs.manifestPaths.length > 0
        ? inputs.manifestPaths
        : parsedParams.manifestPaths;
    const includeDevDependencies = coerceBoolean(
      inputs.includeDevDependencies,
      parsedParams.includeDevDependencies,
    );
    const identity = parseGitHubRepositoryIdentity(inputs.repositoryUrl);
    const effectiveRef = await resolveEffectiveRef(
      context,
      inputs.ref,
      parsedParams.ref,
      identity.owner,
      identity.repo,
    );
    const repo: RepoContext = { ...identity, ref: effectiveRef };
    const manifestPaths = Array.from(new Set(effectiveManifestPaths.map(cleanPath)));

    context.logger.info(
      `[ManifestExtractor] Fetching ${manifestPaths.length} manifest path(s) from ${repo.repository}@${repo.ref}`,
    );
    context.emitProgress({
      message: `Fetching ${manifestPaths.length} repository manifest path(s)`,
      level: 'info',
      data: { repository: repo.repository, ref: repo.ref },
    });

    const npmPackageSpecs: string[] = [];
    const pypiPackageSpecs: string[] = [];
    const goPackageSpecs: string[] = [];
    const mavenPackageSpecs: string[] = [];
    const packagistPackageSpecs: string[] = [];
    const npmPackagesByIdentity = new Map<string, number>();
    const npmLockVersionsByIdentity = new Map<string, string>();
    const pypiPackagesByIdentity = new Map<string, number>();
    const pypiLockVersionsByIdentity = new Map<string, string>();
    const goPackagesByIdentity = new Map<string, number>();
    const mavenPackagesByIdentity = new Map<string, number>();
    const packagistPackagesByIdentity = new Map<string, number>();
    const packagistLockVersionsByIdentity = new Map<string, string>();
    const manifests: z.infer<typeof manifestRecordSchema>[] = [];
    let bounded = false;

    for (const path of manifestPaths) {
      const url = buildRawGitHubUrl(repo, path);
      const fetched = await fetchRawManifest(context, url);
      if (fetched.status < 200 || fetched.status >= 300) {
        manifests.push({
          path,
          ecosystem: 'unknown',
          status: fetched.status,
          packageCount: 0,
          error: fetched.error,
        });
        continue;
      }

      const extracted = extractManifest(
        path,
        fetched.raw,
        includeDevDependencies,
        parsedParams.maxPackages,
      );
      if (!extracted) {
        manifests.push({
          path,
          ecosystem: 'unknown',
          status: fetched.status,
          packageCount: 0,
        });
        continue;
      }

      if (extracted.ecosystem === 'npm-lock') {
        mergeLockVersions(npmLockVersionsByIdentity, extracted.lockVersionsByIdentity);
      } else if (extracted.ecosystem === 'PyPI-lock') {
        mergeLockVersions(pypiLockVersionsByIdentity, extracted.lockVersionsByIdentity);
      } else if (extracted.ecosystem === 'Packagist-lock') {
        mergeLockVersions(packagistLockVersionsByIdentity, extracted.lockVersionsByIdentity);
      }

      for (const spec of extracted.packageSpecs) {
        if (extracted.ecosystem === 'npm') {
          addPackageSpec(npmPackageSpecs, npmPackagesByIdentity, spec);
        } else if (extracted.ecosystem === 'PyPI') {
          addPackageSpec(pypiPackageSpecs, pypiPackagesByIdentity, spec);
        } else if (extracted.ecosystem === 'Go') {
          addPackageSpec(goPackageSpecs, goPackagesByIdentity, spec);
        } else if (extracted.ecosystem === 'Maven' || extracted.ecosystem === 'Gradle') {
          addPackageSpec(mavenPackageSpecs, mavenPackagesByIdentity, spec);
        } else if (extracted.ecosystem === 'Packagist') {
          addPackageSpec(packagistPackageSpecs, packagistPackagesByIdentity, spec);
        }
      }

      bounded = bounded || extracted.packageSpecs.length >= parsedParams.maxPackages;
      manifests.push({
        path,
        ecosystem: extracted.ecosystem,
        status: fetched.status,
        packageCount: extracted.packageSpecs.length,
        excludedDevDependencyCount: extracted.excludedDevDependencyCount,
        missingExactVersions: extracted.missingExactVersions,
      });
    }

    const resolvedNpmPackageSpecs = applyNpmLockVersions(
      npmPackageSpecs,
      npmLockVersionsByIdentity,
    );
    const resolvedPypiPackageSpecs = applyPypiLockVersions(
      pypiPackageSpecs,
      pypiLockVersionsByIdentity,
    );
    const resolvedPackagistPackageSpecs = applyPackagistLockVersions(
      packagistPackageSpecs,
      packagistLockVersionsByIdentity,
    );
    const output = {
      npmPackageSpecs: resolvedNpmPackageSpecs.slice(0, parsedParams.maxPackages),
      pypiPackageSpecs: resolvedPypiPackageSpecs.slice(0, parsedParams.maxPackages),
      goPackageSpecs: goPackageSpecs.slice(0, parsedParams.maxPackages),
      mavenPackageSpecs: mavenPackageSpecs.slice(0, parsedParams.maxPackages),
      packagistPackageSpecs: resolvedPackagistPackageSpecs.slice(0, parsedParams.maxPackages),
      manifests,
      summary: {
        repository: repo.repository,
        owner: repo.owner,
        repo: repo.repo,
        ref: repo.ref,
        manifestsFetched: manifests.length,
        manifestsFound: manifests.filter(
          (manifest) => manifest.status >= 200 && manifest.status < 300,
        ).length,
        npmPackages: resolvedNpmPackageSpecs.length,
        pypiPackages: resolvedPypiPackageSpecs.length,
        goPackages: goPackageSpecs.length,
        mavenPackages: mavenPackageSpecs.length,
        packagistPackages: resolvedPackagistPackageSpecs.length,
        bounded,
      },
    };

    context.logger.info(
      `[ManifestExtractor] Extracted ${output.npmPackageSpecs.length} npm, ${output.pypiPackageSpecs.length} PyPI, ${output.goPackageSpecs.length} Go, ${output.mavenPackageSpecs.length} Maven, and ${output.packagistPackageSpecs.length} Packagist package spec(s)`,
    );

    return output;
  },
});

componentRegistry.register(definition);

type RepositoryManifestExtractorInput = typeof inputSchema;
type RepositoryManifestExtractorOutput = typeof outputSchema;

export type { RepositoryManifestExtractorInput, RepositoryManifestExtractorOutput };
export { definition };
