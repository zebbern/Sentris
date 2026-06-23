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

interface TreeItem {
  path?: string;
  type?: string;
  size?: number;
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

function treeUrl(repo: RepoContext): string {
  return `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(
    repo.repo,
  )}/git/trees/${encodePath(repo.ref)}?recursive=1`;
}

function rawFileUrl(repo: RepoContext, path: string): string {
  return `https://raw.githubusercontent.com/${encodeURIComponent(repo.owner)}/${encodeURIComponent(
    repo.repo,
  )}/${encodePath(repo.ref)}/${encodePath(path)}`;
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

async function fetchJson(context: Pick<ExecutionContext, 'http'>, url: string): Promise<unknown> {
  const response = await context.http.fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/vnd.github+json, application/json' },
  });
  if (!response.ok) {
    throw new Error(`GitHub tree fetch failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function fetchText(context: Pick<ExecutionContext, 'http'>, url: string): Promise<string> {
  const response = await context.http.fetch(url, {
    method: 'GET',
    headers: { Accept: 'text/plain, */*' },
  });
  if (!response.ok) {
    throw new Error(`Raw file fetch failed: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

const definition = defineComponent({
  id: 'sentris.repository.files.extract',
  label: 'Repository Files Extractor',
  category: 'security',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Fetch bounded source and IaC files from an authorized public GitHub repository for downstream SAST and IaC scanners.',
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
    documentationUrl: 'https://docs.github.com/en/rest/git/trees',
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
    const effectiveRef = await resolveEffectiveRef(
      context,
      inputs.ref,
      parsedParams.ref,
      identity.owner,
      identity.repo,
    );
    const repo: RepoContext = { ...identity, ref: effectiveRef };

    context.logger.info(`[RepoFilesExtractor] Fetching tree for ${repo.repository}@${repo.ref}`);
    const tree = fetchTreeItems(await fetchJson(context, treeUrl(repo)));

    const selected: Candidate[] = [];
    const skippedFiles: z.infer<typeof skippedFileSchema>[] = [];
    let totalBytes = 0;
    let truncated = false;

    for (const item of tree) {
      const path = typeof item.path === 'string' ? item.path : '';
      const size = Number(item.size ?? 0);
      if (!path || item.type !== 'blob') continue;

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
        const content = await fetchText(context, rawFileUrl(repo, candidate.path));
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
          reason: error instanceof Error ? `fetch_failed:${error.message}` : 'fetch_failed',
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

function fetchTreeItems(value: unknown): TreeItem[] {
  if (!value || typeof value !== 'object') return [];
  const tree = (value as { tree?: unknown }).tree;
  return Array.isArray(tree) ? (tree as TreeItem[]) : [];
}

componentRegistry.register(definition);

type RepositoryFilesExtractorInput = typeof inputSchema;
type RepositoryFilesExtractorOutput = typeof outputSchema;

export type { RepositoryFilesExtractorInput, RepositoryFilesExtractorOutput };
export { definition };
