import { afterEach, describe, expect, it, vi } from 'bun:test';
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

function createContext(
  responses: Record<string, unknown | string | { status: number; body: unknown }>,
) {
  const fetchMock = vi.fn(async (url: string | URL | Request): Promise<Response> => {
    const text = String(url);
    const value = responses[text];

    if (value === undefined) {
      return new Response('not found', { status: 404, statusText: 'Not Found' });
    }

    if (typeof value === 'object' && value !== null && 'status' in value && 'body' in value) {
      const body = (value as { body: unknown }).body;
      return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status: Number((value as { status: number }).status),
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(typeof value === 'string' ? value : JSON.stringify(value), {
      status: 200,
      headers: { 'Content-Type': typeof value === 'string' ? 'text/plain' : 'application/json' },
    });
  });

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

  it('fetches bounded public GitHub files and splits code from IaC bundles', async () => {
    const component = componentRegistry.get<any, any>('sentris.repository.files.extract');
    if (!component) throw new Error('Repository files extractor component was not registered');

    const treeUrl = 'https://api.github.com/repos/example/project/git/trees/main?recursive=1';
    const rawBase = 'https://raw.githubusercontent.com/example/project/main';
    const { context, fetchMock } = createContext({
      [treeUrl]: {
        tree: [
          { path: 'src/server.js', type: 'blob', size: 42 },
          { path: 'infra/main.tf', type: 'blob', size: 52 },
          { path: 'k8s/deployment.yaml', type: 'blob', size: 74 },
          { path: 'Dockerfile', type: 'blob', size: 18 },
          { path: 'node_modules/left-pad/index.js', type: 'blob', size: 12 },
          { path: 'assets/logo.png', type: 'blob', size: 2048 },
        ],
      },
      [`${rawBase}/src/server.js`]: 'const token = process.env.API_KEY;\n',
      [`${rawBase}/infra/main.tf`]: 'resource "aws_s3_bucket" "public" { acl = "public-read" }\n',
      [`${rawBase}/k8s/deployment.yaml`]:
        'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web\n',
      [`${rawBase}/Dockerfile`]: 'FROM node:18\nUSER root\n',
    });

    const result = (await component.execute(
      {
        inputs: {
          repositoryUrl: 'https://github.com/example/project',
          ref: 'main',
        },
        params: {
          maxFiles: 20,
          maxTotalBytes: 10_000,
          maxFileBytes: 5_000,
        },
      },
      context,
    )) as RepoFilesExtractorResult;

    expect(fetchMock).toHaveBeenCalledTimes(5);
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

    const treeUrl = 'https://api.github.com/repos/example/project/git/trees/main?recursive=1';
    const rawBase = 'https://raw.githubusercontent.com/example/project/main';
    const { context } = createContext({
      [treeUrl]: {
        tree: [
          { path: '.github/workflows/ci.yml', type: 'blob', size: 132 },
          { path: 'src/server.js', type: 'blob', size: 42 },
        ],
      },
      [`${rawBase}/.github/workflows/ci.yml`]:
        'name: ci\non: pull_request_target\npermissions:\n  contents: write\n',
      [`${rawBase}/src/server.js`]: 'console.log("app");\n',
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

  it('enforces file and byte bounds before fetching raw content', async () => {
    const component = componentRegistry.get<any, any>('sentris.repository.files.extract');
    if (!component) throw new Error('Repository files extractor component was not registered');

    const treeUrl = 'https://api.github.com/repos/example/project/git/trees/main?recursive=1';
    const rawBase = 'https://raw.githubusercontent.com/example/project/main';
    const { context, fetchMock } = createContext({
      [treeUrl]: {
        tree: [
          { path: 'a.js', type: 'blob', size: 10 },
          { path: 'b.py', type: 'blob', size: 10 },
          { path: 'c.go', type: 'blob', size: 10 },
        ],
      },
      [`${rawBase}/a.js`]: 'console.log("a")',
      [`${rawBase}/b.py`]: 'print("b")',
      [`${rawBase}/c.go`]: 'package main',
    });

    const result = (await component.execute(
      {
        inputs: {
          repositoryUrl: 'https://github.com/example/project',
        },
        params: {
          maxFiles: 2,
          maxTotalBytes: 1_000,
          maxFileBytes: 10_000,
        },
      },
      context,
    )) as RepoFilesExtractorResult;

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(result.files.map((file) => file.path)).toEqual(['a.js', 'b.py']);
    expect(result.summary.truncated).toBe(true);
    expect(result.skippedFiles).toContainEqual({ path: 'c.go', reason: 'max_files' });
  });

  it('classifies serverless framework manifests as CloudFormation input', async () => {
    const component = componentRegistry.get<any, any>('sentris.repository.files.extract');
    if (!component) throw new Error('Repository files extractor component was not registered');

    const treeUrl = 'https://api.github.com/repos/example/project/git/trees/main?recursive=1';
    const rawBase = 'https://raw.githubusercontent.com/example/project/main';
    const { context } = createContext({
      [treeUrl]: {
        tree: [{ path: 'serverless.yml', type: 'blob', size: 94 }],
      },
      [`${rawBase}/serverless.yml`]:
        'service: public-api\nprovider:\n  name: aws\nfunctions:\n  api:\n    handler: handler.main\n',
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

    const treeUrl = 'https://api.github.com/repos/example/project/git/trees/main?recursive=1';
    const rawBase = 'https://raw.githubusercontent.com/example/project/main';
    const { context } = createContext({
      [treeUrl]: {
        tree: [{ path: 'cloudformation/template.json', type: 'blob', size: 120 }],
      },
      [`${rawBase}/cloudformation/template.json`]: JSON.stringify({
        AWSTemplateFormatVersion: '2010-09-09',
        Resources: {
          Bucket: {
            Type: 'AWS::S3::Bucket',
          },
        },
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
    const treeUrl = 'https://api.github.com/repos/OWASP/NodeGoat/git/trees/master?recursive=1';
    const rawBase = 'https://raw.githubusercontent.com/OWASP/NodeGoat/master';
    const { context, fetchMock } = createContext({
      [metadataUrl]: { default_branch: 'master' },
      [treeUrl]: {
        tree: [{ path: 'app/server.js', type: 'blob', size: 42 }],
      },
      [`${rawBase}/app/server.js`]: 'console.log("nodegoat");\n',
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
    expect(result.ref).toBe('master');
    expect(result.summary.ref).toBe('master');
    expect(result.summary.repository).toBe('https://github.com/OWASP/NodeGoat');
    expect(result.files.map((file) => file.path)).toEqual(['app/server.js']);
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
