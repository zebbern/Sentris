import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'bun:test';
import {
  componentRegistry,
  createExecutionContext,
  type ComponentDefinition,
  type ExecutionContext,
} from '@sentris/component-sdk';

const extractedArchives: string[] = [];

vi.mock('../../../utils/isolated-volume', () => ({
  IsolatedContainerVolume: class {
    async initialize() {
      return 'tenant-test-run-test-1';
    }
    async extractTarGzArchiveFromPath(path: string) {
      extractedArchives.push(path);
    }
    async cleanup() {}
    getVolumeName() {
      return 'tenant-test-run-test-1';
    }
  },
}));

import '../npm-package-source';

function tarHeader(name: string, size: number): Buffer {
  const header = Buffer.alloc(512, 0);
  header.write(name, 0, 100, 'utf8');
  header.write('0000644\0', 100, 8, 'ascii');
  header.write('0000000\0', 108, 8, 'ascii');
  header.write('0000000\0', 116, 8, 'ascii');
  header.write(size.toString(8).padStart(11, '0') + '\0', 124, 12, 'ascii');
  header.write('00000000000\0', 136, 12, 'ascii');
  header.fill(' ', 148, 156);
  header.write('0', 156, 1, 'ascii');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');

  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return header;
}

function createTgz(files: Record<string, string>): Buffer {
  const chunks: Buffer[] = [];
  for (const [path, content] of Object.entries(files)) {
    const body = Buffer.from(content, 'utf8');
    chunks.push(tarHeader(path, body.length), body);
    const padding = (512 - (body.length % 512)) % 512;
    if (padding > 0) chunks.push(Buffer.alloc(padding, 0));
  }
  chunks.push(Buffer.alloc(1024, 0));
  return gzipSync(Buffer.concat(chunks));
}

describe('sentris.npm.package.source', () => {
  afterEach(() => {
    extractedArchives.length = 0;
    vi.restoreAllMocks();
  });

  it('downloads the resolved npm tarball and emits installable artifact provenance', async () => {
    const tarball = createTgz({
      'package/lib/source-map-consumer.js': 'export function consume(map) { return map; }\n',
      'package/README.md': '# source-map-js\n',
    });
    const metadata = {
      name: 'source-map-js',
      'dist-tags': { latest: '1.2.1' },
      time: { '1.2.1': '2025-09-09T00:00:00.000Z' },
      repository: { url: 'git+https://github.com/7rulnik/source-map-js.git' },
      versions: {
        '1.2.1': {
          name: 'source-map-js',
          version: '1.2.1',
          dist: {
            tarball: 'https://registry.npmjs.org/source-map-js/-/source-map-js-1.2.1.tgz',
            integrity: 'sha512-test',
            shasum: 'abc123',
          },
        },
      },
    };

    const fetchMock = vi.fn(async (url: string | URL | Request): Promise<Response> => {
      const text = String(url);
      if (text === 'https://registry.npmjs.org/source-map-js') {
        return new Response(JSON.stringify(metadata), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (text === 'https://registry.npmjs.org/source-map-js/-/source-map-js-1.2.1.tgz') {
        return new Response(tarball, {
          status: 200,
          headers: { 'Content-Type': 'application/octet-stream' },
        });
      }
      return new Response('not found', { status: 404 });
    });

    const context = createExecutionContext({
      runId: 'run-npm-source-test',
      componentRef: 'npm-package-source-test',
    });
    context.http.fetch = fetchMock as ExecutionContext['http']['fetch'];

    const component = componentRegistry.get('sentris.npm.package.source') as
      | ComponentDefinition
      | undefined;
    expect(component).toBeDefined();

    const result = (await component!.execute(
      {
        inputs: { packageSpec: 'source-map-js' },
        params: {
          emitSourceBundle: true,
          maxFileBytes: 50_000,
          maxTotalBytes: 250_000,
          maxArchiveBytes: 5_000_000,
        },
      },
      context,
    )) as {
      volumeName: string;
      volumePath: string;
      packageName: string;
      resolvedVersion: string;
      tarballUrl: string;
      sourceBundle: string;
      sourceStatus: Record<string, unknown>;
      packageProvenance: Record<string, unknown>;
    };

    expect(result.volumeName).toBe('tenant-test-run-test-1');
    expect(result.volumePath).toBe('/repo');
    expect(result.packageName).toBe('source-map-js');
    expect(result.resolvedVersion).toBe('1.2.1');
    expect(result.tarballUrl).toBe(
      'https://registry.npmjs.org/source-map-js/-/source-map-js-1.2.1.tgz',
    );
    expect(result.sourceBundle).toContain('# FILE: lib/source-map-consumer.js');
    expect(result.sourceStatus).toEqual(
      expect.objectContaining({
        mode: 'npm-tarball-source',
        sourceProvided: true,
        installable: true,
        resolvedVersion: '1.2.1',
      }),
    );
    expect(result.packageProvenance).toEqual(
      expect.objectContaining({
        sourceType: 'npm-tarball',
        installable: true,
        packageName: 'source-map-js',
        resolvedVersion: '1.2.1',
        integrity: 'sha512-test',
        shasum: 'abc123',
      }),
    );
    expect(extractedArchives).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('includes dist source files from the published npm tarball', async () => {
    const tarball = createTgz({
      'package/dist/commonjs/index.js':
        'exports.match = function match(value) { return value; };\n',
      'package/dist/esm/index.js': 'export function match(value) { return value; }\n',
      'package/README.md': '# minimatch\n',
    });
    const metadata = {
      name: 'minimatch',
      'dist-tags': { latest: '10.2.5' },
      time: { '10.2.5': '2026-01-01T00:00:00.000Z' },
      repository: { url: 'git+https://github.com/isaacs/minimatch.git' },
      versions: {
        '10.2.5': {
          name: 'minimatch',
          version: '10.2.5',
          dist: {
            tarball: 'https://registry.npmjs.org/minimatch/-/minimatch-10.2.5.tgz',
            integrity: 'sha512-minimatch',
            shasum: 'def456',
          },
        },
      },
    };

    const fetchMock = vi.fn(async (url: string | URL | Request): Promise<Response> => {
      const text = String(url);
      if (text === 'https://registry.npmjs.org/minimatch') {
        return new Response(JSON.stringify(metadata), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (text === 'https://registry.npmjs.org/minimatch/-/minimatch-10.2.5.tgz') {
        return new Response(tarball, {
          status: 200,
          headers: { 'Content-Type': 'application/octet-stream' },
        });
      }
      return new Response('not found', { status: 404 });
    });

    const context = createExecutionContext({
      runId: 'run-npm-dist-source-test',
      componentRef: 'npm-package-dist-source-test',
    });
    context.http.fetch = fetchMock as ExecutionContext['http']['fetch'];

    const component = componentRegistry.get('sentris.npm.package.source') as
      | ComponentDefinition
      | undefined;
    expect(component).toBeDefined();

    const result = (await component!.execute(
      {
        inputs: { packageSpec: 'minimatch' },
        params: {
          emitSourceBundle: true,
          maxFileBytes: 50_000,
          maxTotalBytes: 250_000,
          maxArchiveBytes: 5_000_000,
        },
      },
      context,
    )) as {
      sourceBundle: string;
      sourceStatus: Record<string, unknown>;
    };

    expect(result.sourceBundle).toContain('# FILE: dist/commonjs/index.js');
    expect(result.sourceBundle).toContain('# FILE: dist/esm/index.js');
    expect(result.sourceStatus).toEqual(
      expect.objectContaining({
        sourceProvided: true,
        selectedFiles: 2,
      }),
    );
  });
});
