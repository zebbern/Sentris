import { afterEach, describe, expect, it, vi } from 'bun:test';
import AdmZip from 'adm-zip';
import {
  componentRegistry,
  createExecutionContext,
  type ExecutionContext,
} from '@sentris/component-sdk';
import '../repo-files-extractor';

interface RepoFilesExtractorResult {
  sourceBundle: string;
  githubActionsBundle: string;
  terraformBundle: string;
  kubernetesBundle: string;
  dockerfileBundle: string;
  cloudformationBundle: string;
  ref: string;
  files: {
    path: string;
    size: number;
    category: string;
    language?: string;
  }[];
  skippedFiles: {
    path: string;
    reason: string;
  }[];
  summary: {
    repository: string;
    ref: string;
    selectedFiles: number;
    skippedFiles: number;
    sourceFiles: number;
    githubActionsFiles: number;
    terraformFiles: number;
    kubernetesFiles: number;
    dockerfileFiles: number;
    cloudformationFiles: number;
    truncated: boolean;
  };
}

function zipballUrl(owner: string, repo: string, ref: string): string {
  const encodedRef = ref
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/zipball/${encodedRef}`;
}

function createRepoZip(files: Record<string, string>, root = 'example-project-abc123'): Buffer {
  const zip = new AdmZip();
  for (const [path, content] of Object.entries(files)) {
    zip.addFile(`${root}/${path}`, Buffer.from(content, 'utf8'));
  }
  return zip.toBuffer();
}

function createContext(
  responses: Record<string, unknown | string | Buffer | { status: number; body: unknown }>,
) {
  const fetchMock = vi.fn(
    async (
      url: string | URL | Request,
      _init?: RequestInit,
      _options?: unknown,
    ): Promise<Response> => {
      const text = String(url);
      const value = responses[text];

      if (value === undefined) {
        return new Response('not found', { status: 404, statusText: 'Not Found' });
      }

      if (typeof value === 'object' && value !== null && 'status' in value && 'body' in value) {
        const body = (value as { body: unknown }).body;
        if (Buffer.isBuffer(body)) {
          return new Response(body, {
            status: Number((value as { status: number }).status),
            headers: { 'Content-Type': 'application/zip' },
          });
        }
        return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
          status: Number((value as { status: number }).status),
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (Buffer.isBuffer(value)) {
        return new Response(value, {
          status: 200,
          headers: { 'Content-Type': 'application/zip' },
        });
      }

      return new Response(typeof value === 'string' ? value : JSON.stringify(value), {
        status: 200,
        headers: { 'Content-Type': typeof value === 'string' ? 'text/plain' : 'application/json' },
      });
    },
  );

  const context = createExecutionContext({
    runId: 'test-run',
    componentRef: 'repo-files-test',
  });
  context.http.fetch = fetchMock as unknown as ExecutionContext['http']['fetch'];
  return { context, fetchMock };
}

describe('repository files extractor component', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers with component metadata', () => {
    const component = componentRegistry.get('sentris.repository.files.extract');

    expect(component).toBeDefined();
    expect(component?.label).toBe('Repository Files Extractor');
    expect(component?.category).toBe('security');
  });

  it('downloads one zipball and extracts bounded public GitHub files into bundles', async () => {
    const component = componentRegistry.get<any, any>('sentris.repository.files.extract');
    if (!component) throw new Error('Repository files extractor component was not registered');

    const archiveUrl = zipballUrl('example', 'project', 'main');
    const { context, fetchMock } = createContext({
      [archiveUrl]: createRepoZip({
        'src/server.js': 'const token = process.env.API_KEY;\n',
        'infra/main.tf': 'resource "aws_s3_bucket" "public" { acl = "public-read" }\n',
        'k8s/deployment.yaml': 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web\n',
        Dockerfile: 'FROM node:18\nUSER root\n',
        'node_modules/left-pad/index.js': 'module.exports = {};\n',
        'assets/logo.png': 'PNG',
      }),
    });

    const result = (await component.execute(
      {
        inputs: {
          repositoryUrl: 'https://github.com/example/project',
          ref: 'main',
        },
        params: {
          maxTotalBytes: 10_000,
          maxFileBytes: 5_000,
        },
      },
      context,
    )) as RepoFilesExtractorResult;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      archiveUrl,
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'application/vnd.github+json',
        }),
      }),
      { maxResponseBodySize: 0 },
    );
    expect(result.sourceBundle).toContain('FILE: src/server.js');
    expect(result.sourceBundle).toContain('process.env.API_KEY');
    expect(result.terraformBundle).toContain('FILE: infra/main.tf');
    expect(result.kubernetesBundle).toContain('FILE: k8s/deployment.yaml');
    expect(result.dockerfileBundle).toContain('FILE: Dockerfile');
    expect(result.sourceBundle).not.toContain('left-pad');
    expect(result.summary).toMatchObject({
      repository: 'https://github.com/example/project',
      ref: 'main',
      selectedFiles: 4,
      skippedFiles: 2,
      sourceFiles: 1,
      terraformFiles: 1,
      kubernetesFiles: 1,
      dockerfileFiles: 1,
      cloudformationFiles: 0,
      truncated: false,
    });
    expect(result.skippedFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'node_modules/left-pad/index.js',
          reason: 'excluded_path',
        }),
        expect.objectContaining({ path: 'assets/logo.png', reason: 'unsupported_type' }),
      ]),
    );
  });

  it('extracts GitHub Actions workflows into a dedicated bundle', async () => {
    const component = componentRegistry.get<any, any>('sentris.repository.files.extract');
    if (!component) throw new Error('Repository files extractor component was not registered');

    const archiveUrl = zipballUrl('example', 'project', 'main');
    const metadataUrl = 'https://api.github.com/repos/example/project';
    const { context } = createContext({
      [metadataUrl]: { default_branch: 'main' },
      [archiveUrl]: createRepoZip({
        '.github/workflows/ci.yml':
          'name: ci\non: pull_request_target\npermissions:\n  contents: write\n',
        'src/server.js': 'console.log("app");\n',
      }),
    });

    const result = (await component.execute(
      {
        inputs: {
          repositoryUrl: 'https://github.com/example/project',
          ref: 'main',
        },
        params: {},
      },
      context,
    )) as RepoFilesExtractorResult;

    expect(result.githubActionsBundle).toContain('FILE: .github/workflows/ci.yml');
    expect(result.githubActionsBundle).toContain('pull_request_target');
    expect(result.sourceBundle).toContain('FILE: src/server.js');
    expect(result.sourceBundle).toContain('FILE: .github/workflows/ci.yml');
    expect(result.files).toContainEqual(
      expect.objectContaining({
        path: '.github/workflows/ci.yml',
        category: 'github-actions',
      }),
    );
    expect(result.summary).toMatchObject({
      githubActionsFiles: 1,
      sourceFiles: 1,
    });
  });

  it('enforces byte bounds before reading archive content', async () => {
    const component = componentRegistry.get<any, any>('sentris.repository.files.extract');
    if (!component) throw new Error('Repository files extractor component was not registered');

    const archiveUrl = zipballUrl('example', 'project', 'main');
    const { context, fetchMock } = createContext({
      [archiveUrl]: createRepoZip({
        'a.js': 'a'.repeat(400),
        'b.py': 'b'.repeat(400),
        'c.go': 'c'.repeat(400),
      }),
    });

    const result = (await component.execute(
      {
        inputs: {
          repositoryUrl: 'https://github.com/example/project',
          ref: 'main',
        },
        params: {
          maxTotalBytes: 1_000,
          maxFileBytes: 10_000,
        },
      },
      context,
    )) as RepoFilesExtractorResult;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.files.map((file) => file.path)).toEqual(['a.js', 'b.py']);
    expect(result.summary.truncated).toBe(true);
    expect(result.skippedFiles).toContainEqual({ path: 'c.go', reason: 'max_total_bytes' });
  });

  it('classifies serverless framework manifests as CloudFormation input', async () => {
    const component = componentRegistry.get<any, any>('sentris.repository.files.extract');
    if (!component) throw new Error('Repository files extractor component was not registered');

    const archiveUrl = zipballUrl('example', 'project', 'main');
    const metadataUrl = 'https://api.github.com/repos/example/project';
    const { context } = createContext({
      [metadataUrl]: { default_branch: 'main' },
      [archiveUrl]: createRepoZip({
        'serverless.yml':
          'service: public-api\nprovider:\n  name: aws\nfunctions:\n  api:\n    handler: handler.main\n',
      }),
    });

    const result = (await component.execute(
      {
        inputs: {
          repositoryUrl: 'https://github.com/example/project',
        },
        params: {},
      },
      context,
    )) as RepoFilesExtractorResult;

    expect(result.cloudformationBundle).toContain('FILE: serverless.yml');
    expect(result.sourceBundle).not.toContain('serverless.yml');
    expect(result.summary.cloudformationFiles).toBe(1);
    expect(result.summary.sourceFiles).toBe(0);
  });

  it('classifies JSON CloudFormation templates as CloudFormation input', async () => {
    const component = componentRegistry.get<any, any>('sentris.repository.files.extract');
    if (!component) throw new Error('Repository files extractor component was not registered');

    const archiveUrl = zipballUrl('example', 'project', 'main');
    const metadataUrl = 'https://api.github.com/repos/example/project';
    const { context } = createContext({
      [metadataUrl]: { default_branch: 'main' },
      [archiveUrl]: createRepoZip({
        'cloudformation/template.json': JSON.stringify({
          AWSTemplateFormatVersion: '2010-09-09',
          Resources: {
            Bucket: {
              Type: 'AWS::S3::Bucket',
            },
          },
        }),
      }),
    });

    const result = (await component.execute(
      {
        inputs: {
          repositoryUrl: 'https://github.com/example/project',
        },
        params: {},
      },
      context,
    )) as RepoFilesExtractorResult;

    expect(result.cloudformationBundle).toContain('FILE: cloudformation/template.json');
    expect(result.sourceBundle).not.toContain('cloudformation/template.json');
    expect(result.summary.cloudformationFiles).toBe(1);
    expect(result.summary.sourceFiles).toBe(0);
  });

  it('uses the GitHub default branch when ref is omitted', async () => {
    const component = componentRegistry.get<any, any>('sentris.repository.files.extract');
    if (!component) throw new Error('Repository files extractor component was not registered');

    const metadataUrl = 'https://api.github.com/repos/OWASP/NodeGoat';
    const archiveUrl = zipballUrl('OWASP', 'NodeGoat', 'master');
    const { context, fetchMock } = createContext({
      [metadataUrl]: { default_branch: 'master' },
      [archiveUrl]: createRepoZip(
        {
          'app/server.js': 'console.log("nodegoat");\n',
        },
        'NodeGoat-master-sha',
      ),
    });

    const result = (await component.execute(
      {
        inputs: {
          repositoryUrl: 'https://github.com/OWASP/NodeGoat',
          ref: '',
        },
        params: {},
      },
      context,
    )) as RepoFilesExtractorResult;

    expect(fetchMock).toHaveBeenCalledWith(metadataUrl, expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith(archiveUrl, expect.any(Object), {
      maxResponseBodySize: 0,
    });
    expect(result.ref).toBe('master');
    expect(result.summary.ref).toBe('master');
    expect(result.summary.repository).toBe('https://github.com/OWASP/NodeGoat');
    expect(result.files.map((file) => file.path)).toEqual(['app/server.js']);
  });

  it('sends the GitHub token when provided', async () => {
    const component = componentRegistry.get<any, any>('sentris.repository.files.extract');
    if (!component) throw new Error('Repository files extractor component was not registered');

    const archiveUrl = zipballUrl('example', 'project', 'main');
    const { context, fetchMock } = createContext({
      [archiveUrl]: createRepoZip({
        'src/server.js': 'console.log("ok");\n',
      }),
    });

    await component.execute(
      {
        inputs: {
          repositoryUrl: 'https://github.com/example/project',
          ref: 'main',
          githubToken: 'ghp_test-token',
        },
        params: {},
      },
      context,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      archiveUrl,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer ghp_test-token',
        }),
      }),
      { maxResponseBodySize: 0 },
    );
  });

  it('probes common branch names when repository metadata is unavailable', async () => {
    const component = componentRegistry.get<any, any>('sentris.repository.files.extract');
    if (!component) throw new Error('Repository files extractor component was not registered');

    const metadataUrl = 'https://api.github.com/repos/example/project';
    const masterBranchUrl = 'https://api.github.com/repos/example/project/branches/master';
    const archiveUrl = zipballUrl('example', 'project', 'master');
    const { context } = createContext({
      [metadataUrl]: { status: 403, body: { message: 'rate limit' } },
      [masterBranchUrl]: { name: 'master' },
      [archiveUrl]: createRepoZip({
        'src/server.js': 'console.log("master");\n',
      }),
    });

    const result = (await component.execute(
      {
        inputs: {
          repositoryUrl: 'https://github.com/example/project',
        },
        params: {},
      },
      context,
    )) as RepoFilesExtractorResult;

    expect(result.ref).toBe('master');
    expect(result.files.map((file) => file.path)).toEqual(['src/server.js']);
  });

  it('falls back to codeload archive download when GitHub API endpoints are unavailable', async () => {
    const component = componentRegistry.get<any, any>('sentris.repository.files.extract');
    if (!component) throw new Error('Repository files extractor component was not registered');

    const metadataUrl = 'https://api.github.com/repos/example/project';
    const mainBranchUrl = 'https://api.github.com/repos/example/project/branches/main';
    const codeloadUrl = 'https://codeload.github.com/example/project/zip/refs/heads/main';
    const { context } = createContext({
      [metadataUrl]: { status: 403, body: { message: 'rate limit' } },
      [mainBranchUrl]: { status: 403, body: { message: 'rate limit' } },
      [codeloadUrl]: createRepoZip({
        'src/server.js': 'console.log("codeload");\n',
      }),
    });

    const result = (await component.execute(
      {
        inputs: {
          repositoryUrl: 'https://github.com/example/project',
        },
        params: {},
      },
      context,
    )) as RepoFilesExtractorResult;

    expect(result.ref).toBe('main');
    expect(result.files.map((file) => file.path)).toEqual(['src/server.js']);
  });

  it('rejects non-GitHub repository URLs', async () => {
    const component = componentRegistry.get<any, any>('sentris.repository.files.extract');
    if (!component) throw new Error('Repository files extractor component was not registered');

    const { context } = createContext({});

    await expect(
      component.execute(
        {
          inputs: {
            repositoryUrl: 'https://gitlab.com/example/project',
          },
          params: {},
        },
        context,
      ),
    ).rejects.toThrow('Only github.com repository URLs are supported');
  });
});
