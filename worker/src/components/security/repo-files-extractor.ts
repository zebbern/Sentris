import { createRequire } from 'node:module';
import { z } from 'zod';
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

const require = createRequire(import.meta.url);
const AdmZip = require('adm-zip') as typeof import('adm-zip');

const DEFAULT_EXCLUDED_SEGMENTS = new Set([
  '.git',
  '.hg',
  '.svn',
  '.next',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'target',
  'vendor',
]);

const SOURCE_EXTENSIONS = new Map<string, string>([
  ['.c', 'c'],
  ['.cc', 'cpp'],
  ['.cpp', 'cpp'],
  ['.cs', 'csharp'],
  ['.go', 'go'],
  ['.java', 'java'],
  ['.js', 'javascript'],
  ['.jsx', 'javascript'],
  ['.php', 'php'],
  ['.py', 'python'],
  ['.rb', 'ruby'],
  ['.rs', 'rust'],
  ['.ts', 'typescript'],
  ['.tsx', 'typescript'],
]);

const inputSchema = inputs({
  repositoryUrl: port(
    z.string().url().describe('Public GitHub repository URL to inspect for source and IaC files.'),
    {
      label: 'Repository URL',
      description: 'Public GitHub repository URL explicitly authorized for code/IaC review.',
      connectionType: { kind: 'primitive', name: 'text' },
    },
  ),
  ref: port(z.string().trim().optional().describe('Git ref to read files from.'), {
    label: 'Git Ref',
    description: 'Optional branch, tag, or commit. Overrides the component default ref.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  githubToken: port(
    z.string().trim().optional().describe('Optional GitHub token for archive download.'),
    {
      label: 'GitHub Token',
      description: 'Optional PAT or fine-grained token to raise GitHub API rate limits.',
      editor: 'secret',
      connectionType: { kind: 'primitive', name: 'secret' },
    },
  ),
});

const parameterSchema = parameters({
  ref: param(z.string().trim().default('main').describe('Git ref to read files from.'), {
    label: 'Git Ref',
    editor: 'text',
    description: 'Branch, tag, or commit to read files from.',
  }),
  maxFiles: param(
    z.number().int().min(1).max(500).default(80).describe('Maximum files to fetch.'),
    {
      label: 'Max Files',
      editor: 'number',
      min: 1,
      max: 500,
    },
  ),
  maxTotalBytes: param(
    z
      .number()
      .int()
      .min(1_000)
      .max(2_000_000)
      .default(250_000)
      .describe('Maximum total bytes to fetch.'),
    {
      label: 'Max Total Bytes',
      editor: 'number',
      min: 1_000,
      max: 2_000_000,
    },
  ),
  maxFileBytes: param(
    z
      .number()
      .int()
      .min(100)
      .max(500_000)
      .default(50_000)
      .describe('Maximum size for an individual file.'),
    {
      label: 'Max File Bytes',
      editor: 'number',
      min: 100,
      max: 500_000,
    },
  ),
  maxArchiveBytes: param(
    z
      .number()
      .int()
      .min(10_000)
      .max(50_000_000)
      .default(10_000_000)
      .describe('Maximum GitHub zipball archive size to download.'),
    {
      label: 'Max Archive Bytes',
      editor: 'number',
      min: 10_000,
      max: 50_000_000,
    },
  ),
});

const fileRecordSchema = z.object({
  path: z.string(),
  size: z.number(),
  category: z.string(),
  language: z.string().optional(),
});

const skippedFileSchema = z.object({
  path: z.string(),
  reason: z.string(),
});

const summarySchema = z.object({
  repository: z.string(),
  owner: z.string(),
  repo: z.string(),
  ref: z.string(),
  selectedFiles: z.number(),
  skippedFiles: z.number(),
  sourceFiles: z.number(),
  githubActionsFiles: z.number(),
  terraformFiles: z.number(),
  kubernetesFiles: z.number(),
  dockerfileFiles: z.number(),
  cloudformationFiles: z.number(),
  totalBytes: z.number(),
  truncated: z.boolean(),
});

const outputSchema = outputs({
  ref: port(z.string(), {
    label: 'Resolved Git Ref',
    description: 'Branch, tag, or commit actually used for repository extraction.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  sourceBundle: port(z.string(), {
    label: 'Source Bundle',
    description: 'Bounded source-code bundle suitable for Semgrep content scans.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  githubActionsBundle: port(z.string(), {
    label: 'GitHub Actions Bundle',
    description: 'Bounded GitHub Actions workflow YAML bundle for CI/CD supply-chain review.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  terraformBundle: port(z.string(), {
    label: 'Terraform Bundle',
    description: 'Bounded Terraform content suitable for Checkov Terraform scans.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  kubernetesBundle: port(z.string(), {
    label: 'Kubernetes Bundle',
    description: 'Bounded Kubernetes YAML content suitable for Checkov Kubernetes scans.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  dockerfileBundle: port(z.string(), {
    label: 'Dockerfile Bundle',
    description: 'Bounded Dockerfile content suitable for Checkov Dockerfile scans.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  cloudformationBundle: port(z.string(), {
    label: 'CloudFormation Bundle',
    description: 'Bounded CloudFormation content suitable for Checkov CloudFormation scans.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  files: port(z.array(fileRecordSchema), {
    label: 'Selected Files',
    description: 'Files fetched and included in the output bundles.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  }),
  skippedFiles: port(z.array(skippedFileSchema), {
    label: 'Skipped Files',
    description: 'Files skipped because of type filters or configured bounds.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  }),
  summary: port(summarySchema, {
    label: 'Extraction Summary',
    description: 'Repository file extraction counts and bounds.',
    connectionType: { kind: 'primitive', name: 'json' },
  }),
});

interface RepoContext {
  repository: string;
  owner: string;
  repo: string;
  ref: string;
}

interface ArchiveFile {
  path: string;
  size: number;
  content: Buffer;
}

interface Candidate {
  path: string;
  size: number;
  category: string;
  language?: string;
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

function buildGithubHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const trimmed = token?.trim();
  if (trimmed) {
    headers.Authorization = `Bearer ${trimmed}`;
  }
  return headers;
}

async function resolveEffectiveRef(
  context: Pick<ExecutionContext, 'http'>,
  inputRef: unknown,
  fallbackRef: string,
  owner: string,
  repo: string,
  headers: Record<string, string>,
): Promise<string> {
  if (typeof inputRef === 'string' && inputRef.trim().length > 0) {
    return cleanRef(inputRef);
  }

  const metadataUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  try {
    const response = await context.http.fetch(metadataUrl, {
      method: 'GET',
      headers,
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

function zipballUrl(repo: RepoContext): string {
  return `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(
    repo.repo,
  )}/zipball/${encodePath(repo.ref)}`;
}

function normalizeZipEntryPath(entryName: string): string | null {
  const normalized = entryName.replace(/\\/g, '/');
  if (normalized.includes('..') || normalized.startsWith('/')) {
    return null;
  }

  const parts = normalized.split('/').filter(Boolean);
  if (parts.length < 2) {
    return null;
  }

  return parts.slice(1).join('/');
}

function listArchiveFiles(archive: Buffer): ArchiveFile[] {
  const zip = new AdmZip(archive);
  const files: ArchiveFile[] = [];

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) {
      continue;
    }

    const path = normalizeZipEntryPath(entry.entryName);
    if (!path) {
      continue;
    }

    const content = entry.getData();
    files.push({
      path,
      size: content.length,
      content,
    });
  }

  return files;
}

function pathSegments(path: string): string[] {
  return path.split('/').filter(Boolean);
}

function extensionFor(path: string): string {
  const name = pathSegments(path).pop() ?? path;
  const index = name.lastIndexOf('.');
  return index > -1 ? name.slice(index).toLowerCase() : '';
}

function isExcludedPath(path: string): boolean {
  return pathSegments(path).some((segment) => DEFAULT_EXCLUDED_SEGMENTS.has(segment));
}

function isLikelyCloudFormationJsonPath(lowerPath: string, lowerName: string): boolean {
  return (
    lowerPath.includes('/cloudformation/') ||
    lowerPath.includes('/cfn/') ||
    lowerName === 'cloudformation.json' ||
    lowerName === 'template.json' ||
    lowerName.endsWith('.template.json')
  );
}

function isGitHubActionsWorkflowPath(path: string): boolean {
  const segments = pathSegments(path);
  if (segments.length !== 3) return false;
  const [root, directory, fileName] = segments;
  const lowerName = fileName.toLowerCase();
  return (
    root === '.github' &&
    directory === 'workflows' &&
    (lowerName.endsWith('.yml') || lowerName.endsWith('.yaml'))
  );
}

function classifyByPath(path: string): { category: string; language?: string } | null {
  const segments = pathSegments(path);
  const name = segments[segments.length - 1] ?? path;
  const lowerName = name.toLowerCase();
  const lowerPath = path.toLowerCase();
  const extension = extensionFor(path);

  if (isGitHubActionsWorkflowPath(path)) {
    return { category: 'github-actions', language: 'yaml' };
  }
  if (lowerName === 'dockerfile' || lowerName.endsWith('.dockerfile')) {
    return { category: 'dockerfile' };
  }
  if (extension === '.tf' || extension === '.tfvars') {
    return { category: 'terraform' };
  }
  if (lowerPath.endsWith('serverless.yml') || lowerPath.endsWith('serverless.yaml')) {
    return { category: 'cloudformation' };
  }
  if (extension === '.json' && isLikelyCloudFormationJsonPath(lowerPath, lowerName)) {
    return { category: 'json', language: 'json' };
  }
  if (extension === '.yaml' || extension === '.yml') {
    return { category: 'yaml' };
  }

  const language = SOURCE_EXTENSIONS.get(extension);
  return language ? { category: 'source', language } : null;
}

function refineCategory(candidate: Candidate, content: string): Candidate {
  if (candidate.category === 'github-actions') return candidate;
  if (candidate.category === 'json') {
    try {
      const parsed = JSON.parse(content) as unknown;
      if (
        parsed &&
        typeof parsed === 'object' &&
        'Resources' in parsed &&
        typeof (parsed as { Resources?: unknown }).Resources === 'object'
      ) {
        return { ...candidate, category: 'cloudformation', language: undefined };
      }
    } catch {
      // Fall through to source JSON when a likely template path is not valid JSON.
    }
    return { ...candidate, category: 'source', language: 'json' };
  }
  if (candidate.category !== 'yaml') return candidate;
  if (/AWSTemplateFormatVersion|Resources:\s*\n/i.test(content)) {
    return { ...candidate, category: 'cloudformation' };
  }
  if (/apiVersion:\s*[^\n]+[\s\S]*kind:\s*[A-Za-z]/i.test(content)) {
    return { ...candidate, category: 'kubernetes' };
  }
  return { ...candidate, category: 'source', language: 'yaml' };
}

function appendBundle(existing: string, path: string, content: string): string {
  return `${existing}${existing ? '\n' : ''}# FILE: ${path}\n${content.trimEnd()}\n`;
}

async function fetchArchive(
  context: Pick<ExecutionContext, 'http'>,
  url: string,
  headers: Record<string, string>,
  maxArchiveBytes: number,
): Promise<Buffer> {
  const response = await context.http.fetch(url, {
    method: 'GET',
    headers,
  });
  if (!response.ok) {
    throw new Error(`GitHub archive fetch failed: ${response.status} ${response.statusText}`);
  }

  const archive = Buffer.from(await response.arrayBuffer());
  if (archive.length > maxArchiveBytes) {
    throw new ValidationError('GitHub archive exceeds configured maxArchiveBytes', {
      fieldErrors: {
        maxArchiveBytes: [
          `Archive size ${archive.length} bytes exceeds limit ${maxArchiveBytes} bytes`,
        ],
      },
    });
  }

  return archive;
}

const definition = defineComponent({
  id: 'sentris.repository.files.extract',
  label: 'Repository Files Extractor',
  category: 'security',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Download a GitHub zipball snapshot and extract bounded source and IaC files for downstream SAST and IaC scanners.',
  toolProvider: {
    kind: 'component',
    name: 'repository_files_extract',
    description: 'Extract bounded source and IaC file bundles from public GitHub repositories.',
  },
  ui: {
    slug: 'repository-files-extractor',
    version: '1.0.0',
    type: 'process',
    category: 'security',
    description:
      'Extract bounded source, Terraform, Kubernetes, Dockerfile, and CloudFormation bundles from public GitHub repositories.',
    documentationUrl:
      'https://docs.github.com/en/rest/repos/contents#download-a-repository-archive-zip',
    icon: 'Files',
    author: {
      name: 'SentrisAI',
      type: 'sentris',
    },
    isLatest: true,
    deprecated: false,
    examples: [
      'Fetch source code for Semgrep from a small public repository.',
      'Extract Terraform and Kubernetes manifests for Checkov scans.',
    ],
  },
  async execute({ inputs, params }, context) {
    const parsedParams = parameterSchema.parse(params);
    const identity = parseGitHubRepositoryIdentity(inputs.repositoryUrl);
    const githubHeaders = buildGithubHeaders(
      typeof inputs.githubToken === 'string' ? inputs.githubToken : undefined,
    );
    const effectiveRef = await resolveEffectiveRef(
      context,
      inputs.ref,
      parsedParams.ref,
      identity.owner,
      identity.repo,
      githubHeaders,
    );
    const repo: RepoContext = { ...identity, ref: effectiveRef };

    context.logger.info(
      `[RepoFilesExtractor] Downloading zipball for ${repo.repository}@${repo.ref}`,
    );
    const archive = await fetchArchive(
      context,
      zipballUrl(repo),
      githubHeaders,
      parsedParams.maxArchiveBytes,
    );
    const archiveFiles = listArchiveFiles(archive);
    const contentByPath = new Map(archiveFiles.map((file) => [file.path, file.content]));

    const selected: Candidate[] = [];
    const skippedFiles: z.infer<typeof skippedFileSchema>[] = [];
    let totalBytes = 0;
    let truncated = false;

    for (const item of archiveFiles) {
      const { path, size } = item;
      if (isExcludedPath(path)) {
        skippedFiles.push({ path, reason: 'excluded_path' });
        continue;
      }

      const classification = classifyByPath(path);
      if (!classification) {
        skippedFiles.push({ path, reason: 'unsupported_type' });
        continue;
      }

      if (selected.length >= parsedParams.maxFiles) {
        skippedFiles.push({ path, reason: 'max_files' });
        truncated = true;
        continue;
      }
      if (size > parsedParams.maxFileBytes) {
        skippedFiles.push({ path, reason: 'max_file_bytes' });
        truncated = true;
        continue;
      }
      if (totalBytes + size > parsedParams.maxTotalBytes) {
        skippedFiles.push({ path, reason: 'max_total_bytes' });
        truncated = true;
        continue;
      }

      selected.push({ path, size, ...classification });
      totalBytes += size;
    }

    let sourceBundle = '';
    let githubActionsBundle = '';
    let terraformBundle = '';
    let kubernetesBundle = '';
    let dockerfileBundle = '';
    let cloudformationBundle = '';
    const files: z.infer<typeof fileRecordSchema>[] = [];

    for (const candidate of selected) {
      try {
        const rawContent = contentByPath.get(candidate.path);
        if (!rawContent) {
          skippedFiles.push({ path: candidate.path, reason: 'archive_missing_entry' });
          truncated = true;
          continue;
        }

        const content = rawContent.toString('utf8');
        const refined = refineCategory(candidate, content);
        files.push(refined);

        if (refined.category === 'source') {
          sourceBundle = appendBundle(sourceBundle, refined.path, content);
        } else if (refined.category === 'github-actions') {
          sourceBundle = appendBundle(sourceBundle, refined.path, content);
          githubActionsBundle = appendBundle(githubActionsBundle, refined.path, content);
        } else if (refined.category === 'terraform') {
          terraformBundle = appendBundle(terraformBundle, refined.path, content);
        } else if (refined.category === 'kubernetes') {
          kubernetesBundle = appendBundle(kubernetesBundle, refined.path, content);
        } else if (refined.category === 'dockerfile') {
          dockerfileBundle = appendBundle(dockerfileBundle, refined.path, content);
        } else if (refined.category === 'cloudformation') {
          cloudformationBundle = appendBundle(cloudformationBundle, refined.path, content);
        }
      } catch (error) {
        skippedFiles.push({
          path: candidate.path,
          reason: error instanceof Error ? `extract_failed:${error.message}` : 'extract_failed',
        });
        truncated = true;
      }
    }

    const countByCategory = (category: string) =>
      files.filter((file) => file.category === category).length;

    return {
      ref: repo.ref,
      sourceBundle,
      githubActionsBundle,
      terraformBundle,
      kubernetesBundle,
      dockerfileBundle,
      cloudformationBundle,
      files,
      skippedFiles,
      summary: {
        repository: repo.repository,
        owner: repo.owner,
        repo: repo.repo,
        ref: repo.ref,
        selectedFiles: files.length,
        skippedFiles: skippedFiles.length,
        sourceFiles: countByCategory('source'),
        githubActionsFiles: countByCategory('github-actions'),
        terraformFiles: countByCategory('terraform'),
        kubernetesFiles: countByCategory('kubernetes'),
        dockerfileFiles: countByCategory('dockerfile'),
        cloudformationFiles: countByCategory('cloudformation'),
        totalBytes,
        truncated,
      },
    };
  },
});

componentRegistry.register(definition);

type RepositoryFilesExtractorInput = typeof inputSchema;
type RepositoryFilesExtractorOutput = typeof outputSchema;

export type { RepositoryFilesExtractorInput, RepositoryFilesExtractorOutput };
export { definition, normalizeZipEntryPath, zipballUrl as buildZipballUrl, listArchiveFiles };
