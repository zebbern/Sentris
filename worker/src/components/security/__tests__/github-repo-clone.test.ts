import { afterEach, describe, expect, it, vi } from 'bun:test';
import AdmZip from 'adm-zip';
import {
  componentRegistry,
  createExecutionContext,
  type ComponentDefinition,
  type ExecutionContext,
} from '@sentris/component-sdk';

vi.mock('../../../utils/isolated-volume', () => ({
  IsolatedContainerVolume: class {
    async initialize() {
      return 'tenant-test-run-test-1';
    }
    async extractZipArchive() {}
    async extractZipArchiveFromPath() {}
    async cleanup() {}
    getVolumeName() {
      return 'tenant-test-run-test-1';
    }
  },
}));

import { buildCodeloadZipUrl, parseGitHubRepositoryIdentity } from '../github-archive-utils';
import '../github-repo-clone';

function createRepoZip(files: Record<string, string>, root = 'example-project-abc123'): Buffer {
  const zip = new AdmZip();
  for (const [path, content] of Object.entries(files)) {
    zip.addFile(`${root}/${path}`, Buffer.from(content, 'utf8'));
  }
  return zip.toBuffer();
}

function createContext(responses: Record<string, Buffer | { status: number }>) {
  const fetchMock = vi.fn(
    async (
      url: string | URL | Request,
      _init?: RequestInit,
      _options?: unknown,
    ): Promise<Response> => {
      const text = String(url);
      const direct = responses[text];
      if (direct) {
        if ('status' in direct) {
          return new Response('missing', { status: direct.status, statusText: 'Not Found' });
        }
        return new Response(direct, {
          status: 200,
          headers: { 'Content-Type': 'application/zip' },
        });
      }

      const matched = Object.entries(responses).find(
        ([key]) => text.includes(key) || key.includes(text),
      );
      if (matched) {
        const value = matched[1];
        if ('status' in value) {
          return new Response('missing', { status: value.status, statusText: 'Not Found' });
        }
        return new Response(value, {
          status: 200,
          headers: { 'Content-Type': 'application/zip' },
        });
      }

      return new Response('not found', { status: 404, statusText: 'Not Found' });
    },
  );

  const context = createExecutionContext({
    runId: 'run-clone-test',
    componentRef: 'github-repo-clone-test',
  });
  context.http.fetch = fetchMock as ExecutionContext['http']['fetch'];
  return { context, fetchMock };
}

describe('github archive utils', () => {
  it('builds tag codeload URLs', () => {
    expect(buildCodeloadZipUrl('vercel', 'next.js', 'v16.2.9', 'tag')).toBe(
      'https://codeload.github.com/vercel/next.js/zip/refs/tags/v16.2.9',
    );
  });

  it('parses github repository URLs', () => {
    expect(parseGitHubRepositoryIdentity('https://github.com/vercel/next.js')).toEqual({
      repository: 'https://github.com/vercel/next.js',
      owner: 'vercel',
      repo: 'next.js',
    });
  });
});

describe('sentris.github.repository.clone', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers the component', () => {
    expect(componentRegistry.get('sentris.github.repository.clone')).toBeDefined();
  });

  it('downloads one archive and returns volume metadata plus source bundle', async () => {
    const archive = createRepoZip({
      'src/index.ts': 'export const value = 1;\n',
      'README.md': '# example\n',
    });
    const { context, fetchMock } = createContext({
      'codeload.github.com/acme/demo/zip/refs/tags/v1.0.0': archive,
    });

    const component = componentRegistry.get('sentris.github.repository.clone') as
      | ComponentDefinition
      | undefined;
    expect(component).toBeDefined();

    const result = (await component!.execute(
      {
        inputs: {
          repositoryUrl: 'https://github.com/acme/demo',
          ref: 'v1.0.0',
        },
        params: {
          refKind: 'tag',
          emitSourceBundle: true,
          maxFileBytes: 50_000,
          maxTotalBytes: 250_000,
          maxArchiveBytes: 500_000_000,
        },
      },
      context,
    )) as {
      volumeName: string;
      volumePath: string;
      repository: string;
      ref: string;
      cloneUrl: string;
      sourceBundle: string;
    };

    expect(result.volumeName).toBe('tenant-test-run-test-1');
    expect(result.volumePath).toBe('/repo');
    expect(result.repository).toBe('https://github.com/acme/demo');
    expect(result.ref).toBe('v1.0.0');
    expect(result.cloneUrl).toBe('https://github.com/acme/demo.git');
    expect(result.sourceBundle).toContain('# FILE: src/index.ts');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('codeload.github.com/acme/demo/zip/refs/tags/v1.0.0'),
      expect.objectContaining({ method: 'GET' }),
      { maxResponseBodySize: 0 },
    );
  });

  it('falls back to alternate refs when the primary npm tag is missing', async () => {
    const archive = createRepoZip({
      'src/index.ts': 'export const value = 2;\n',
    });
    const { context, fetchMock } = createContext({
      'codeload.github.com/acme/demo/zip/refs/tags/v1.2.3': { status: 404 },
      'codeload.github.com/acme/demo/zip/refs/tags/1.2.3': archive,
    });

    const component = componentRegistry.get('sentris.github.repository.clone') as
      | ComponentDefinition
      | undefined;
    expect(component).toBeDefined();

    const result = (await component!.execute(
      {
        inputs: {
          repositoryUrl: 'https://github.com/acme/demo',
          ref: 'v1.2.3',
          refCandidates: ['1.2.3', 'main'],
        },
        params: {
          refKind: 'tag',
          emitSourceBundle: true,
          maxFileBytes: 50_000,
          maxTotalBytes: 250_000,
          maxArchiveBytes: 500_000_000,
        },
      },
      context,
    )) as {
      ref: string;
      sourceBundle: string;
    };

    expect(result.ref).toBe('1.2.3');
    expect(result.sourceBundle).toContain('export const value = 2;');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining('codeload.github.com/acme/demo/zip/refs/tags/1.2.3'),
      expect.objectContaining({ method: 'GET' }),
      { maxResponseBodySize: 0 },
    );
  });
});
