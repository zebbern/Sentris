import { afterEach, describe, expect, it, vi } from 'bun:test';
import {
  componentRegistry,
  createExecutionContext,
  extractPorts,
  type ExecutionContext,
} from '@sentris/component-sdk';
import '../manifest-extractor';

interface ManifestExtractorResult {
  npmPackageSpecs: string[];
  pypiPackageSpecs: string[];
  goPackageSpecs: string[];
  mavenPackageSpecs: string[];
  packagistPackageSpecs: string[];
  manifests: {
    path: string;
    ecosystem: string;
    status: number;
    packageCount: number;
    excludedDevDependencyCount?: number;
  }[];
  summary: {
    repository: string;
    ref: string;
    npmPackages: number;
    pypiPackages: number;
    goPackages: number;
    mavenPackages: number;
    packagistPackages: number;
  };
}

describe('repository manifest extractor component', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers with component metadata', () => {
    const component = componentRegistry.get('sentris.repository.manifest.extract');

    expect(component).toBeDefined();
    expect(component?.label).toBe('Repository Manifest Extractor');
    expect(component?.category).toBe('security');
  });

  it('exposes includeDevDependencies as a boolean input port', () => {
    const component = componentRegistry.get('sentris.repository.manifest.extract');
    if (!component) throw new Error('Manifest extractor component was not registered');

    const ports = extractPorts(component.inputs);
    const includeDevDependencies = ports.find((port) => port.id === 'includeDevDependencies');

    expect(includeDevDependencies?.connectionType).toEqual({
      kind: 'primitive',
      name: 'boolean',
    });
  });

  it('extracts exact direct npm dependencies from a GitHub package lockfile', async () => {
    const component = componentRegistry.get<any, any>('sentris.repository.manifest.extract');
    if (!component) throw new Error('Manifest extractor component was not registered');

    const lockfile = {
      packages: {
        '': {
          dependencies: {
            lodash: '^4.17.20',
            minimist: '^0.0.8',
          },
          devDependencies: {
            jest: '^29.0.0',
          },
        },
        'node_modules/lodash': { version: '4.17.20' },
        'node_modules/minimist': { version: '0.0.8' },
        'node_modules/jest': { version: '29.0.0' },
      },
    };

    const fetchMock = vi.fn(async (url: string | URL | Request): Promise<Response> => {
      const text = String(url);
      if (text.endsWith('/package-lock.json')) {
        return Response.json(lockfile);
      }
      return new Response('not found', { status: 404, statusText: 'Not Found' });
    });

    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'manifest-test',
    });
    context.http.fetch = fetchMock as unknown as ExecutionContext['http']['fetch'];

    const result = (await component.execute(
      {
        inputs: {
          repositoryUrl: 'https://github.com/OWASP/NodeGoat',
        },
        params: {
          ref: 'master',
          manifestPaths: ['package-lock.json'],
          includeDevDependencies: false,
          maxPackages: 80,
        },
      },
      context,
    )) as ManifestExtractorResult;

    expect(result.npmPackageSpecs).toEqual(['lodash@4.17.20', 'minimist@0.0.8']);
    expect(result.npmPackageSpecs).not.toContain('jest@29.0.0');
    expect(result.summary).toMatchObject({
      repository: 'https://github.com/OWASP/NodeGoat',
      ref: 'master',
      npmPackages: 2,
      pypiPackages: 0,
      goPackages: 0,
      mavenPackages: 0,
    });
    expect(result.manifests[0]).toMatchObject({
      path: 'package-lock.json',
      ecosystem: 'npm',
      status: 200,
      packageCount: 2,
      excludedDevDependencyCount: 1,
    });
  });

  it('extracts exact dependencies from legacy npm package lockfiles', async () => {
    const component = componentRegistry.get<any, any>('sentris.repository.manifest.extract');
    if (!component) throw new Error('Manifest extractor component was not registered');

    const lockfile = {
      lockfileVersion: 1,
      dependencies: {
        lodash: { version: '4.17.20' },
        minimist: { version: '0.0.8' },
        jest: { version: '29.0.0', dev: true },
      },
    };

    const fetchMock = vi.fn(async (url: string | URL | Request): Promise<Response> => {
      const text = String(url);
      if (text.endsWith('/package-lock.json')) {
        return Response.json(lockfile);
      }
      return new Response('not found', { status: 404, statusText: 'Not Found' });
    });

    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'manifest-test',
    });
    context.http.fetch = fetchMock as unknown as ExecutionContext['http']['fetch'];

    const result = (await component.execute(
      {
        inputs: {
          repositoryUrl: 'https://github.com/legacy/npm-app',
        },
        params: {
          ref: 'main',
          manifestPaths: ['package-lock.json'],
          includeDevDependencies: false,
          maxPackages: 80,
        },
      },
      context,
    )) as ManifestExtractorResult;

    expect(result.npmPackageSpecs).toEqual(['lodash@4.17.20', 'minimist@0.0.8']);
    expect(result.npmPackageSpecs).not.toContain('jest@29.0.0');
    expect(result.summary.npmPackages).toBe(2);
    expect(result.manifests[0]).toMatchObject({
      path: 'package-lock.json',
      ecosystem: 'npm',
      status: 200,
      packageCount: 2,
      excludedDevDependencyCount: 1,
    });
  });

  it('lets workflow inputs override default ref, manifest paths, and dev dependency settings', async () => {
    const component = componentRegistry.get<any, any>('sentris.repository.manifest.extract');
    if (!component) throw new Error('Manifest extractor component was not registered');

    const lockfile = {
      packages: {
        '': {
          dependencies: {
            lodash: '^4.17.20',
          },
          devDependencies: {
            jest: '^29.0.0',
          },
        },
        'node_modules/lodash': { version: '4.17.20' },
        'node_modules/jest': { version: '29.0.0' },
      },
    };

    const fetchMock = vi.fn(async (url: string | URL | Request): Promise<Response> => {
      const text = String(url);
      expect(text).toContain('/master/package-lock.json');
      return Response.json(lockfile);
    });

    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'manifest-test',
    });
    context.http.fetch = fetchMock as unknown as ExecutionContext['http']['fetch'];

    const result = (await component.execute(
      {
        inputs: {
          repositoryUrl: 'https://github.com/OWASP/NodeGoat',
          ref: 'master',
          manifestPaths: ['package-lock.json'],
          includeDevDependencies: true,
        },
        params: {
          ref: 'main',
          manifestPaths: ['package.json'],
          includeDevDependencies: false,
          maxPackages: 80,
        },
      },
      context,
    )) as ManifestExtractorResult;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.npmPackageSpecs).toEqual(['jest@29.0.0', 'lodash@4.17.20']);
    expect(result.manifests[0]).toMatchObject({
      excludedDevDependencyCount: 0,
    });
  });

  it('uses the GitHub default branch when ref is omitted', async () => {
    const component = componentRegistry.get<any, any>('sentris.repository.manifest.extract');
    if (!component) throw new Error('Manifest extractor component was not registered');

    const lockfile = {
      packages: {
        '': {
          dependencies: {
            lodash: '^4.17.20',
          },
        },
        'node_modules/lodash': { version: '4.17.20' },
      },
    };
    const metadataUrl = 'https://api.github.com/repos/OWASP/NodeGoat';
    const manifestUrl = 'https://raw.githubusercontent.com/OWASP/NodeGoat/master/package-lock.json';

    const fetchMock = vi.fn(async (url: string | URL | Request): Promise<Response> => {
      const text = String(url);
      if (text === metadataUrl) {
        return Response.json({ default_branch: 'master' });
      }
      if (text === manifestUrl) {
        return Response.json(lockfile);
      }
      return new Response('not found', { status: 404, statusText: 'Not Found' });
    });

    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'manifest-test',
    });
    context.http.fetch = fetchMock as unknown as ExecutionContext['http']['fetch'];

    const result = (await component.execute(
      {
        inputs: {
          repositoryUrl: 'https://github.com/OWASP/NodeGoat',
          ref: '',
          manifestPaths: ['package-lock.json'],
        },
        params: {
          ref: 'main',
          manifestPaths: ['package.json'],
          includeDevDependencies: false,
          maxPackages: 80,
        },
      },
      context,
    )) as ManifestExtractorResult;

    expect(fetchMock).toHaveBeenCalledWith(metadataUrl, expect.any(Object));
    expect(result.summary.ref).toBe('master');
    expect(result.npmPackageSpecs).toEqual(['lodash@4.17.20']);
  });

  it('deduplicates npm package names across package-lock.json and package.json', async () => {
    const component = componentRegistry.get<any, any>('sentris.repository.manifest.extract');
    if (!component) throw new Error('Manifest extractor component was not registered');

    const lockfile = {
      packages: {
        '': {
          dependencies: {
            lodash: '^4.17.20',
          },
        },
        'node_modules/lodash': { version: '4.17.20' },
      },
    };
    const packageJson = {
      dependencies: {
        lodash: '^4.17.20',
        minimist: '^0.0.8',
      },
    };

    const fetchMock = vi.fn(async (url: string | URL | Request): Promise<Response> => {
      const text = String(url);
      if (text.endsWith('/package-lock.json')) {
        return Response.json(lockfile);
      }
      if (text.endsWith('/package.json')) {
        return Response.json(packageJson);
      }
      return new Response('not found', { status: 404, statusText: 'Not Found' });
    });

    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'manifest-test',
    });
    context.http.fetch = fetchMock as unknown as ExecutionContext['http']['fetch'];

    const result = (await component.execute(
      {
        inputs: {
          repositoryUrl: 'https://github.com/example/project',
          manifestPaths: ['package-lock.json', 'package.json'],
        },
        params: {
          ref: 'main',
          manifestPaths: ['requirements.txt'],
          includeDevDependencies: false,
          maxPackages: 80,
        },
      },
      context,
    )) as ManifestExtractorResult;

    expect(result.npmPackageSpecs).toEqual(['lodash@4.17.20', 'minimist']);
    expect(result.summary.npmPackages).toBe(2);
  });

  it('extracts exact direct npm dependencies from pnpm lockfiles', async () => {
    const component = componentRegistry.get<any, any>('sentris.repository.manifest.extract');
    if (!component) throw new Error('Manifest extractor component was not registered');

    const pnpmLock = [
      "lockfileVersion: '9.0'",
      'importers:',
      '  .:',
      '    dependencies:',
      '      axios:',
      "        specifier: '^1.6.0'",
      '        version: 1.6.8',
      '      lodash:',
      "        specifier: '^4.17.20'",
      '        version: 4.17.21',
      '    devDependencies:',
      '      vitest:',
      "        specifier: '^1.6.0'",
      '        version: 1.6.1',
      'packages:',
      '  axios@1.6.8:',
      '    resolution: {integrity: sha512-test}',
      '  lodash@4.17.21:',
      '    resolution: {integrity: sha512-test}',
      '  vitest@1.6.1:',
      '    resolution: {integrity: sha512-test}',
    ].join('\n');

    const fetchMock = vi.fn(async (url: string | URL | Request): Promise<Response> => {
      const text = String(url);
      if (text.endsWith('/pnpm-lock.yaml')) {
        return new Response(pnpmLock, { status: 200 });
      }
      return new Response('not found', { status: 404, statusText: 'Not Found' });
    });

    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'manifest-test',
    });
    context.http.fetch = fetchMock as unknown as ExecutionContext['http']['fetch'];

    const result = (await component.execute(
      {
        inputs: {
          repositoryUrl: 'https://github.com/example/pnpm-app',
          manifestPaths: ['pnpm-lock.yaml'],
        },
        params: {
          ref: 'main',
          manifestPaths: ['package-lock.json'],
          includeDevDependencies: false,
          maxPackages: 80,
        },
      },
      context,
    )) as ManifestExtractorResult;

    expect(result.npmPackageSpecs).toEqual(['axios@1.6.8', 'lodash@4.17.21']);
    expect(result.npmPackageSpecs).not.toContain('vitest@1.6.1');
    expect(result.summary.npmPackages).toBe(2);
    expect(result.manifests[0]).toMatchObject({
      path: 'pnpm-lock.yaml',
      ecosystem: 'npm',
      packageCount: 2,
      excludedDevDependencyCount: 1,
    });
  });

  it('uses yarn.lock to add exact versions for package.json dependencies without adding transitive packages', async () => {
    const component = componentRegistry.get<any, any>('sentris.repository.manifest.extract');
    if (!component) throw new Error('Manifest extractor component was not registered');

    const packageJson = {
      dependencies: {
        '@scope/widget': '^2.0.0',
        lodash: '^4.17.20',
      },
    };
    const yarnLock = [
      '"@scope/widget@^2.0.0":',
      '  version "2.0.3"',
      '  resolved "https://registry.yarnpkg.com/@scope/widget/-/widget-2.0.3.tgz"',
      '',
      'lodash@^4.17.20:',
      '  version "4.17.21"',
      '  resolved "https://registry.yarnpkg.com/lodash/-/lodash-4.17.21.tgz"',
      '  dependencies:',
      '    left-pad "^1.3.0"',
      '',
      'left-pad@^1.3.0:',
      '  version "1.3.0"',
      '  resolved "https://registry.yarnpkg.com/left-pad/-/left-pad-1.3.0.tgz"',
    ].join('\n');

    const fetchMock = vi.fn(async (url: string | URL | Request): Promise<Response> => {
      const text = String(url);
      if (text.endsWith('/package.json')) {
        return Response.json(packageJson);
      }
      if (text.endsWith('/yarn.lock')) {
        return new Response(yarnLock, { status: 200 });
      }
      return new Response('not found', { status: 404, statusText: 'Not Found' });
    });

    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'manifest-test',
    });
    context.http.fetch = fetchMock as unknown as ExecutionContext['http']['fetch'];

    const result = (await component.execute(
      {
        inputs: {
          repositoryUrl: 'https://github.com/example/yarn-app',
          manifestPaths: ['package.json', 'yarn.lock'],
        },
        params: {
          ref: 'main',
          manifestPaths: ['package-lock.json'],
          includeDevDependencies: false,
          maxPackages: 80,
        },
      },
      context,
    )) as ManifestExtractorResult;

    expect(result.npmPackageSpecs).toEqual(['@scope/widget@2.0.3', 'lodash@4.17.21']);
    expect(result.npmPackageSpecs).not.toContain('left-pad@1.3.0');
    expect(result.summary.npmPackages).toBe(2);
    expect(result.manifests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'yarn.lock',
          ecosystem: 'npm-lock',
          packageCount: 0,
        }),
      ]),
    );
  });

  it('extracts PyPI and Go package specs from requirements.txt and go.mod', async () => {
    const component = componentRegistry.get<any, any>('sentris.repository.manifest.extract');
    if (!component) throw new Error('Manifest extractor component was not registered');

    const fetchMock = vi.fn(async (url: string | URL | Request): Promise<Response> => {
      const text = String(url);
      if (text.endsWith('/requirements.txt')) {
        return new Response(
          ['requests==2.31.0', 'flask>=2.0', '# comment', 'urllib3==1.26.18'].join('\n'),
          { status: 200 },
        );
      }
      if (text.endsWith('/go.mod')) {
        return new Response(
          ['module example.com/app', 'require (', 'github.com/gin-gonic/gin v1.9.1', ')'].join(
            '\n',
          ),
          { status: 200 },
        );
      }
      return new Response('not found', { status: 404, statusText: 'Not Found' });
    });

    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'manifest-test',
    });
    context.http.fetch = fetchMock as unknown as ExecutionContext['http']['fetch'];

    const result = (await component.execute(
      {
        inputs: {
          repositoryUrl: 'https://github.com/example/mixed-app',
        },
        params: {
          ref: 'main',
          manifestPaths: ['requirements.txt', 'go.mod'],
          includeDevDependencies: false,
          maxPackages: 80,
        },
      },
      context,
    )) as ManifestExtractorResult;

    expect(result.pypiPackageSpecs).toEqual(['requests@2.31.0', 'flask', 'urllib3@1.26.18']);
    expect(result.goPackageSpecs).toEqual(['github.com/gin-gonic/gin@v1.9.1']);
    expect(result.summary).toMatchObject({
      pypiPackages: 3,
      goPackages: 1,
    });
  });

  it('extracts direct PyPI dependencies from pyproject.toml and uses poetry.lock without adding transitive packages', async () => {
    const component = componentRegistry.get<any, any>('sentris.repository.manifest.extract');
    if (!component) throw new Error('Manifest extractor component was not registered');

    const pyproject = [
      '[project]',
      'dependencies = [',
      '  "requests>=2.31",',
      '  "urllib3==1.26.18",',
      ']',
      '',
      '[project.optional-dependencies]',
      'dev = ["pytest==8.2.0"]',
      '',
      '[tool.poetry.dependencies]',
      'python = "^3.11"',
      'django = "^4.2"',
    ].join('\n');
    const poetryLock = [
      '[[package]]',
      'name = "requests"',
      'version = "2.31.0"',
      '',
      '[[package]]',
      'name = "django"',
      'version = "4.2.11"',
      '',
      '[[package]]',
      'name = "certifi"',
      'version = "2024.2.2"',
    ].join('\n');

    const fetchMock = vi.fn(async (url: string | URL | Request): Promise<Response> => {
      const text = String(url);
      if (text.endsWith('/poetry.lock')) {
        return new Response(poetryLock, { status: 200 });
      }
      if (text.endsWith('/pyproject.toml')) {
        return new Response(pyproject, { status: 200 });
      }
      return new Response('not found', { status: 404, statusText: 'Not Found' });
    });

    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'manifest-test',
    });
    context.http.fetch = fetchMock as unknown as ExecutionContext['http']['fetch'];

    const result = (await component.execute(
      {
        inputs: {
          repositoryUrl: 'https://github.com/example/python-app',
          manifestPaths: ['poetry.lock', 'pyproject.toml'],
        },
        params: {
          ref: 'main',
          manifestPaths: ['requirements.txt'],
          includeDevDependencies: false,
          maxPackages: 80,
        },
      },
      context,
    )) as ManifestExtractorResult;

    expect(result.pypiPackageSpecs).toEqual([
      'django@4.2.11',
      'requests@2.31.0',
      'urllib3@1.26.18',
    ]);
    expect(result.pypiPackageSpecs).not.toContain('certifi@2024.2.2');
    expect(result.pypiPackageSpecs).not.toContain('pytest@8.2.0');
    expect(result.summary.pypiPackages).toBe(3);
    expect(result.manifests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'poetry.lock',
          ecosystem: 'PyPI-lock',
          packageCount: 0,
        }),
        expect.objectContaining({
          path: 'pyproject.toml',
          ecosystem: 'PyPI',
          packageCount: 3,
        }),
      ]),
    );
  });

  it('extracts direct PyPI dependencies from Pipfile and uses Pipfile.lock without adding transitive packages', async () => {
    const component = componentRegistry.get<any, any>('sentris.repository.manifest.extract');
    if (!component) throw new Error('Manifest extractor component was not registered');

    const pipfile = [
      '[packages]',
      'requests = "*"',
      'django = "==4.2.11"',
      'flask = {version = ">=2.3", extras = ["async"]}',
      '',
      '[dev-packages]',
      'pytest = "==8.2.0"',
    ].join('\n');
    const pipfileLock = {
      default: {
        certifi: { version: '==2024.2.2' },
        django: { version: '==4.2.11' },
        flask: { version: '==2.3.3' },
        requests: { version: '==2.31.0' },
      },
      develop: {
        pytest: { version: '==8.2.0' },
      },
    };

    const fetchMock = vi.fn(async (url: string | URL | Request): Promise<Response> => {
      const text = String(url);
      if (text.endsWith('/Pipfile.lock')) {
        return Response.json(pipfileLock);
      }
      if (text.endsWith('/Pipfile')) {
        return new Response(pipfile, { status: 200 });
      }
      return new Response('not found', { status: 404, statusText: 'Not Found' });
    });

    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'manifest-test',
    });
    context.http.fetch = fetchMock as unknown as ExecutionContext['http']['fetch'];

    const result = (await component.execute(
      {
        inputs: {
          repositoryUrl: 'https://github.com/example/pipenv-app',
          manifestPaths: ['Pipfile.lock', 'Pipfile'],
        },
        params: {
          ref: 'main',
          manifestPaths: ['requirements.txt'],
          includeDevDependencies: false,
          maxPackages: 80,
        },
      },
      context,
    )) as ManifestExtractorResult;

    expect(result.pypiPackageSpecs).toEqual(['django@4.2.11', 'flask@2.3.3', 'requests@2.31.0']);
    expect(result.pypiPackageSpecs).not.toContain('certifi@2024.2.2');
    expect(result.pypiPackageSpecs).not.toContain('pytest@8.2.0');
    expect(result.summary.pypiPackages).toBe(3);
    expect(result.manifests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'Pipfile.lock',
          ecosystem: 'PyPI-lock',
          packageCount: 0,
        }),
        expect.objectContaining({
          path: 'Pipfile',
          ecosystem: 'PyPI',
          packageCount: 3,
          excludedDevDependencyCount: 1,
        }),
      ]),
    );
  });

  it('extracts direct Packagist dependencies from Composer manifests without adding transitive packages', async () => {
    const component = componentRegistry.get<any, any>('sentris.repository.manifest.extract');
    if (!component) throw new Error('Manifest extractor component was not registered');

    const composerJson = {
      require: {
        php: '^8.2',
        'ext-json': '*',
        'laravel/framework': '10.48.4',
        'symfony/http-foundation': '^5.4',
      },
      'require-dev': {
        'phpunit/phpunit': '^10.0',
      },
    };
    const composerLock = {
      packages: [
        { name: 'laravel/framework', version: '10.48.4' },
        { name: 'symfony/http-foundation', version: '5.4.46' },
        { name: 'symfony/polyfill-mbstring', version: '1.29.0' },
      ],
      'packages-dev': [{ name: 'phpunit/phpunit', version: '10.5.0' }],
    };

    const fetchMock = vi.fn(async (url: string | URL | Request): Promise<Response> => {
      const text = String(url);
      if (text.endsWith('/composer.lock')) {
        return Response.json(composerLock);
      }
      if (text.endsWith('/composer.json')) {
        return Response.json(composerJson);
      }
      return new Response('not found', { status: 404, statusText: 'Not Found' });
    });

    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'manifest-test',
    });
    context.http.fetch = fetchMock as unknown as ExecutionContext['http']['fetch'];

    const result = (await component.execute(
      {
        inputs: {
          repositoryUrl: 'https://github.com/example/php-app',
          manifestPaths: ['composer.lock', 'composer.json'],
        },
        params: {
          ref: 'main',
          manifestPaths: ['package-lock.json'],
          includeDevDependencies: false,
          maxPackages: 80,
        },
      },
      context,
    )) as ManifestExtractorResult;

    expect(result.packagistPackageSpecs).toEqual([
      'laravel/framework@10.48.4',
      'symfony/http-foundation@5.4.46',
    ]);
    expect(result.packagistPackageSpecs).not.toContain('symfony/polyfill-mbstring@1.29.0');
    expect(result.packagistPackageSpecs).not.toContain('phpunit/phpunit@10.5.0');
    expect(result.summary.packagistPackages).toBe(2);
    expect(result.manifests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'composer.lock',
          ecosystem: 'Packagist-lock',
          packageCount: 0,
        }),
        expect.objectContaining({
          path: 'composer.json',
          ecosystem: 'Packagist',
          packageCount: 2,
          excludedDevDependencyCount: 1,
        }),
      ]),
    );
  });

  it('resolves Maven property versions and excludes test-scoped dependencies by default', async () => {
    const component = componentRegistry.get<any, any>('sentris.repository.manifest.extract');
    if (!component) throw new Error('Manifest extractor component was not registered');

    const pom = [
      '<project>',
      '  <properties>',
      '    <jackson.version>2.15.2</jackson.version>',
      '  </properties>',
      '  <dependencies>',
      '    <dependency>',
      '      <groupId>com.fasterxml.jackson.core</groupId>',
      '      <artifactId>jackson-databind</artifactId>',
      '      <version>${jackson.version}</version>',
      '    </dependency>',
      '    <dependency>',
      '      <groupId>junit</groupId>',
      '      <artifactId>junit</artifactId>',
      '      <version>4.13.2</version>',
      '      <scope>test</scope>',
      '    </dependency>',
      '  </dependencies>',
      '</project>',
    ].join('\n');

    const fetchMock = vi.fn(async (url: string | URL | Request): Promise<Response> => {
      const text = String(url);
      if (text.endsWith('/pom.xml')) {
        return new Response(pom, { status: 200 });
      }
      return new Response('not found', { status: 404, statusText: 'Not Found' });
    });

    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'manifest-test',
    });
    context.http.fetch = fetchMock as unknown as ExecutionContext['http']['fetch'];

    const result = (await component.execute(
      {
        inputs: {
          repositoryUrl: 'https://github.com/example/java-app',
        },
        params: {
          ref: 'main',
          manifestPaths: ['pom.xml'],
          includeDevDependencies: false,
          maxPackages: 80,
        },
      },
      context,
    )) as ManifestExtractorResult;

    expect(result.mavenPackageSpecs).toEqual([
      'com.fasterxml.jackson.core:jackson-databind@2.15.2',
    ]);
    expect(result.mavenPackageSpecs).not.toContain('junit:junit@4.13.2');
    expect(result.summary.mavenPackages).toBe(1);
    expect(result.manifests[0]).toMatchObject({
      path: 'pom.xml',
      ecosystem: 'Maven',
      packageCount: 1,
      excludedDevDependencyCount: 1,
    });
  });

  it('uses Maven dependencyManagement versions without reporting managed-only dependencies', async () => {
    const component = componentRegistry.get<any, any>('sentris.repository.manifest.extract');
    if (!component) throw new Error('Manifest extractor component was not registered');

    const pom = [
      '<project>',
      '  <dependencyManagement>',
      '    <dependencies>',
      '      <dependency>',
      '        <groupId>org.springframework</groupId>',
      '        <artifactId>spring-web</artifactId>',
      '        <version>6.0.11</version>',
      '      </dependency>',
      '      <dependency>',
      '        <groupId>org.springframework</groupId>',
      '        <artifactId>spring-core</artifactId>',
      '        <version>6.0.11</version>',
      '      </dependency>',
      '    </dependencies>',
      '  </dependencyManagement>',
      '  <dependencies>',
      '    <dependency>',
      '      <groupId>org.springframework</groupId>',
      '      <artifactId>spring-web</artifactId>',
      '    </dependency>',
      '  </dependencies>',
      '</project>',
    ].join('\n');

    const fetchMock = vi.fn(async (url: string | URL | Request): Promise<Response> => {
      const text = String(url);
      if (text.endsWith('/pom.xml')) {
        return new Response(pom, { status: 200 });
      }
      return new Response('not found', { status: 404, statusText: 'Not Found' });
    });

    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'manifest-test',
    });
    context.http.fetch = fetchMock as unknown as ExecutionContext['http']['fetch'];

    const result = (await component.execute(
      {
        inputs: {
          repositoryUrl: 'https://github.com/example/spring-app',
        },
        params: {
          ref: 'main',
          manifestPaths: ['pom.xml'],
          includeDevDependencies: false,
          maxPackages: 80,
        },
      },
      context,
    )) as ManifestExtractorResult;

    expect(result.mavenPackageSpecs).toEqual(['org.springframework:spring-web@6.0.11']);
    expect(result.mavenPackageSpecs).not.toContain('org.springframework:spring-core@6.0.11');
    expect(result.manifests[0]).toMatchObject({
      path: 'pom.xml',
      ecosystem: 'Maven',
      packageCount: 1,
    });
  });

  it('extracts Maven package specs from Gradle Groovy dependency declarations', async () => {
    const component = componentRegistry.get<any, any>('sentris.repository.manifest.extract');
    if (!component) throw new Error('Manifest extractor component was not registered');

    const buildGradle = [
      'plugins { id "java" }',
      'dependencies {',
      "  implementation 'org.springframework:spring-web:6.0.11'",
      '  api "com.fasterxml.jackson.core:jackson-databind:2.15.2"',
      "  implementation group: 'org.apache.commons', name: 'commons-lang3', version: '3.12.0'",
      "  testImplementation 'junit:junit:4.13.2'",
      '}',
    ].join('\n');

    const fetchMock = vi.fn(async (url: string | URL | Request): Promise<Response> => {
      const text = String(url);
      if (text.endsWith('/build.gradle')) {
        return new Response(buildGradle, { status: 200 });
      }
      return new Response('not found', { status: 404, statusText: 'Not Found' });
    });

    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'manifest-test',
    });
    context.http.fetch = fetchMock as unknown as ExecutionContext['http']['fetch'];

    const result = (await component.execute(
      {
        inputs: {
          repositoryUrl: 'https://github.com/example/gradle-app',
        },
        params: {
          ref: 'main',
          manifestPaths: ['build.gradle'],
          includeDevDependencies: false,
          maxPackages: 80,
        },
      },
      context,
    )) as ManifestExtractorResult;

    expect(result.mavenPackageSpecs).toEqual([
      'org.springframework:spring-web@6.0.11',
      'com.fasterxml.jackson.core:jackson-databind@2.15.2',
      'org.apache.commons:commons-lang3@3.12.0',
    ]);
    expect(result.mavenPackageSpecs).not.toContain('junit:junit@4.13.2');
    expect(result.summary.mavenPackages).toBe(3);
    expect(result.manifests[0]).toMatchObject({
      path: 'build.gradle',
      ecosystem: 'Gradle',
      packageCount: 3,
      excludedDevDependencyCount: 1,
    });
  });

  it('extracts Maven package specs from Gradle Kotlin dependency declarations', async () => {
    const component = componentRegistry.get<any, any>('sentris.repository.manifest.extract');
    if (!component) throw new Error('Manifest extractor component was not registered');

    const buildGradleKts = [
      'plugins { java }',
      'dependencies {',
      '  implementation("org.springframework:spring-web:6.0.11")',
      '  api("com.fasterxml.jackson.core:jackson-databind:2.15.2")',
      '  implementation(group = "org.apache.commons", name = "commons-text", version = "1.10.0")',
      '  testImplementation("junit:junit:4.13.2")',
      '}',
    ].join('\n');

    const fetchMock = vi.fn(async (url: string | URL | Request): Promise<Response> => {
      const text = String(url);
      if (text.endsWith('/build.gradle.kts')) {
        return new Response(buildGradleKts, { status: 200 });
      }
      return new Response('not found', { status: 404, statusText: 'Not Found' });
    });

    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'manifest-test',
    });
    context.http.fetch = fetchMock as unknown as ExecutionContext['http']['fetch'];

    const result = (await component.execute(
      {
        inputs: {
          repositoryUrl: 'https://github.com/example/gradle-kotlin-app',
        },
        params: {
          ref: 'main',
          manifestPaths: ['build.gradle.kts'],
          includeDevDependencies: false,
          maxPackages: 80,
        },
      },
      context,
    )) as ManifestExtractorResult;

    expect(result.mavenPackageSpecs).toEqual([
      'org.springframework:spring-web@6.0.11',
      'com.fasterxml.jackson.core:jackson-databind@2.15.2',
      'org.apache.commons:commons-text@1.10.0',
    ]);
    expect(result.mavenPackageSpecs).not.toContain('junit:junit@4.13.2');
    expect(result.summary.mavenPackages).toBe(3);
    expect(result.manifests[0]).toMatchObject({
      path: 'build.gradle.kts',
      ecosystem: 'Gradle',
      packageCount: 3,
      excludedDevDependencyCount: 1,
    });
  });

  it('rejects non-GitHub repository URLs', async () => {
    const component = componentRegistry.get<any, any>('sentris.repository.manifest.extract');
    if (!component) throw new Error('Manifest extractor component was not registered');

    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'manifest-test',
    });

    await expect(
      component.execute(
        {
          inputs: {
            repositoryUrl: 'https://gitlab.com/example/repo',
          },
          params: {
            ref: 'main',
            manifestPaths: ['package.json'],
            includeDevDependencies: false,
            maxPackages: 80,
          },
        },
        context,
      ),
    ).rejects.toThrow('Only github.com repository URLs are supported');
  });
});
