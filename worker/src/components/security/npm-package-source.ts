import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finished } from 'node:stream/promises';
import { gunzipSync } from 'node:zlib';
import { z } from 'zod';
import {
  ComponentRetryPolicy,
  ValidationError,
  componentRegistry,
  defineComponent,
  inputs,
  outputs,
  parameters,
  param,
  port,
  type ExecutionContext,
} from '@sentris/component-sdk';
import { IsolatedContainerVolume } from '../../utils/isolated-volume';
import {
  extractSourceBundleFromFiles,
  NPM_TARBALL_EXCLUDED_SEGMENTS,
  type ArchiveFile,
} from './github-source-bundles';

const NPM_REGISTRY_BASE = 'https://registry.npmjs.org';
const PACKAGE_MOUNT_PATH = '/repo';

const npmPackageSourceStatusSchema = z.object({
  mode: z.literal('npm-tarball-source'),
  sourceType: z.literal('npm-tarball'),
  packageName: z.string(),
  requestedSpec: z.string(),
  requestedVersion: z.string().nullable(),
  resolvedVersion: z.string(),
  tarballUrl: z.string(),
  repositoryUrl: z.string().nullable(),
  publishedAt: z.string().nullable(),
  sourceProvided: z.boolean(),
  installable: z.boolean(),
  selectedFiles: z.number(),
  truncated: z.boolean(),
});

const npmPackageProvenanceSchema = z.object({
  sourceType: z.literal('npm-tarball'),
  installable: z.boolean(),
  packageName: z.string(),
  requestedSpec: z.string(),
  requestedVersion: z.string().nullable(),
  resolvedVersion: z.string(),
  resolution: z.string(),
  tarballUrl: z.string(),
  integrity: z.string().nullable(),
  shasum: z.string().nullable(),
  registryUrl: z.string(),
  repositoryUrl: z.string().nullable(),
  publishedAt: z.string().nullable(),
});

const inputSchema = inputs({
  packageSpec: port(
    z.string().trim().min(1).describe('npm package name with optional version or dist-tag.'),
    {
      label: 'Package Spec',
      description: 'npm package spec, for example source-map-js or source-map-js@1.2.1.',
      connectionType: { kind: 'primitive', name: 'text' },
    },
  ),
  registryRecord: port(z.unknown().optional().describe('Optional registry metadata context.'), {
    label: 'Registry Record',
    description: 'Optional normalized registry metadata from NPM Registry Intel.',
    allowAny: true,
    reason: 'Registry records are dynamic JSON emitted by the npm intel component.',
    connectionType: { kind: 'primitive', name: 'json' },
  }),
});

const parameterSchema = parameters({
  emitSourceBundle: param(
    z.boolean().default(true).describe('Build a bounded source bundle for downstream AI agents.'),
    {
      label: 'Emit Source Bundle',
      editor: 'boolean',
      description: 'When enabled, extracts reviewable files from the installable npm tarball.',
    },
  ),
  maxFileBytes: param(
    z
      .number()
      .int()
      .min(100)
      .max(500_000)
      .default(500_000)
      .describe('Maximum size for bundle files.'),
    {
      label: 'Max File Size',
      editor: 'number',
      min: 100,
      max: 500_000,
      description: 'Skip individual files larger than this limit when building source bundles.',
    },
  ),
  maxTotalBytes: param(
    z
      .number()
      .int()
      .min(1_000)
      .max(1_000_000_000)
      .default(5_000_000)
      .describe('Maximum total bytes for source bundles.'),
    {
      label: 'Max Total Size',
      editor: 'number',
      min: 1_000,
      max: 1_000_000_000,
      description: 'Stop bundle extraction once selected file size reaches this limit.',
    },
  ),
  maxArchiveBytes: param(
    z
      .number()
      .int()
      .min(100_000)
      .max(1_000_000_000)
      .default(500_000_000)
      .describe('Maximum npm tarball download size.'),
    {
      label: 'Max Archive Size',
      editor: 'number',
      min: 100_000,
      max: 1_000_000_000,
      description: 'Reject npm tarballs larger than this limit.',
    },
  ),
});

const outputSchema = outputs({
  volumePath: port(z.string(), {
    label: 'Volume Path',
    description: 'Path inside downstream scanner containers where the npm package is mounted.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  volumeName: port(z.string(), {
    label: 'Volume Name',
    description:
      'Docker volume containing the extracted installable npm package. Volumes are cleaned up when the workflow finishes.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  packageName: port(z.string(), {
    label: 'Package Name',
    description: 'Resolved npm package name.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  requestedVersion: port(z.string().nullable(), {
    label: 'Requested Version',
    description: 'Version or dist-tag requested in the package spec, if present.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  resolvedVersion: port(z.string(), {
    label: 'Resolved Version',
    description: 'Concrete npm package version downloaded from the registry.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  tarballUrl: port(z.string(), {
    label: 'Tarball URL',
    description: 'npm registry tarball URL for the resolved version.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  sourceBundle: port(z.string(), {
    label: 'Source Bundle',
    description: 'Bounded review bundle extracted from the installable npm tarball.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  sourceStatus: port(npmPackageSourceStatusSchema, {
    label: 'Source Status',
    description: 'Installable npm artifact source provenance for this package.',
    connectionType: { kind: 'primitive', name: 'json' },
  }),
  packageProvenance: port(npmPackageProvenanceSchema, {
    label: 'Package Provenance',
    description: 'Resolved npm registry version and tarball provenance.',
    connectionType: { kind: 'primitive', name: 'json' },
  }),
});

const npmPackageSourceRetryPolicy: ComponentRetryPolicy = {
  maxAttempts: 3,
  initialIntervalSeconds: 2,
  maximumIntervalSeconds: 30,
  backoffCoefficient: 2,
  nonRetryableErrorTypes: ['ValidationError', 'ConfigurationError'],
};

interface ParsedPackageSpec {
  requestedSpec: string;
  name: string;
  version: string | null;
}

interface NpmTarballDownload {
  path: string;
  bytes: number;
  cleanup: () => Promise<void>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parsePackageSpec(spec: string): ParsedPackageSpec {
  const requestedSpec = spec.trim();
  const normalized = requestedSpec.startsWith('npm:')
    ? requestedSpec.slice(4).trim()
    : requestedSpec;
  const versionAt = normalized.lastIndexOf('@');
  const hasVersion = versionAt > 0;
  const name = hasVersion ? normalized.slice(0, versionAt).trim() : normalized.trim();
  const version = hasVersion ? normalized.slice(versionAt + 1).trim() || null : null;
  if (!name) {
    throw new ValidationError('Package spec must include a package name', {
      fieldErrors: { packageSpec: ['Expected npm package name or name@version'] },
    });
  }
  return { requestedSpec, name, version };
}

function npmMetadataUrl(packageName: string): string {
  return `${NPM_REGISTRY_BASE}/${encodeURIComponent(packageName)}`;
}

function normalizeRepositoryUrl(value: unknown): string | null {
  const direct = stringValue(value);
  if (direct) return direct.replace(/^git\+/, '').replace(/\.git$/i, '');
  const record = asRecord(value);
  const nested = stringValue(record.url);
  return nested ? nested.replace(/^git\+/, '').replace(/\.git$/i, '') : null;
}

function validateNpmTarballUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ValidationError('npm tarball URL is invalid', {
      fieldErrors: { packageSpec: ['Resolved dist.tarball was not a valid URL'] },
    });
  }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'registry.npmjs.org') {
    throw new ValidationError('npm tarball URL must use the public npm registry over HTTPS', {
      fieldErrors: {
        packageSpec: ['Only https://registry.npmjs.org tarballs are supported'],
      },
      details: { tarballUrl: value },
    });
  }
  return url.toString();
}

function resolveVersion(
  parsed: ParsedPackageSpec,
  metadata: Record<string, unknown>,
): {
  resolvedVersion: string;
  resolution: string;
  versionRecord: Record<string, unknown>;
} {
  const distTags = asRecord(metadata['dist-tags']);
  const versions = asRecord(metadata.versions);
  const requested = parsed.version;
  const taggedVersion = requested ? stringValue(distTags[requested]) : null;
  const latest = stringValue(distTags.latest);
  const resolvedVersion = taggedVersion || requested || latest;
  if (!resolvedVersion) {
    throw new ValidationError('Could not resolve npm package version', {
      fieldErrors: { packageSpec: ['No explicit version or latest dist-tag was available'] },
    });
  }
  const versionRecord = asRecord(versions[resolvedVersion]);
  if (!versionRecord.name) {
    throw new ValidationError('Resolved npm package version was not present in metadata', {
      fieldErrors: { packageSpec: [`Version ${resolvedVersion} was not found`] },
    });
  }
  const resolution = taggedVersion
    ? `dist-tag:${requested}`
    : requested
      ? 'explicit-version'
      : 'dist-tag:latest';
  return { resolvedVersion, resolution, versionRecord };
}

function normalizeTarEntryPath(entryName: string): string | null {
  const normalized = entryName.replace(/\\/g, '/');
  if (normalized.includes('..') || normalized.startsWith('/')) {
    return null;
  }
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length === 0) {
    return null;
  }
  return (parts[0] === 'package' && parts.length > 1 ? parts.slice(1) : parts).join('/');
}

function readTarString(block: Buffer, start: number, length: number): string {
  return block
    .subarray(start, start + length)
    .toString('utf8')
    .replace(/\0.*$/s, '')
    .trim();
}

function readTarOctal(block: Buffer, start: number, length: number): number {
  const raw = readTarString(block, start, length).replace(/[^0-7]/g, '');
  return raw ? Number.parseInt(raw, 8) : 0;
}

function isZeroBlock(block: Buffer): boolean {
  for (const byte of block) {
    if (byte !== 0) return false;
  }
  return true;
}

function listTarGzFiles(archive: Buffer): ArchiveFile[] {
  const tar = gunzipSync(archive);
  const files: ArchiveFile[] = [];
  let offset = 0;

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (isZeroBlock(header)) {
      break;
    }

    const name = readTarString(header, 0, 100);
    const prefix = readTarString(header, 345, 155);
    const fullName = prefix ? `${prefix}/${name}` : name;
    const size = readTarOctal(header, 124, 12);
    const typeFlag = header.subarray(156, 157).toString('ascii');
    offset += 512;

    const contentStart = offset;
    const contentEnd = contentStart + size;
    offset += Math.ceil(size / 512) * 512;

    if (typeFlag && typeFlag !== '0') {
      continue;
    }

    const path = normalizeTarEntryPath(fullName);
    if (!path) {
      continue;
    }
    files.push({
      path,
      size,
      content: tar.subarray(contentStart, contentEnd),
    });
  }

  return files;
}

async function fetchTarballToFile(
  context: Pick<ExecutionContext, 'http' | 'emitProgress'>,
  url: string,
  maxArchiveBytes: number,
): Promise<NpmTarballDownload> {
  const response = await context.http.fetch(
    url,
    {
      method: 'GET',
      headers: { Accept: 'application/octet-stream, */*' },
    },
    { maxResponseBodySize: 0 },
  );
  if (!response.ok) {
    throw new Error(`npm tarball fetch failed: ${response.status} ${response.statusText}`);
  }
  if (!response.body) {
    throw new Error('npm tarball fetch returned an empty response body');
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'sentris-npm-tarball-'));
  const archivePath = join(tempDir, 'package.tgz');
  const writeStream = createWriteStream(archivePath);
  const reader = response.body.getReader();
  let bytes = 0;
  let lastProgressMb = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      bytes += value.byteLength;
      if (bytes > maxArchiveBytes) {
        throw new ValidationError('npm tarball exceeds configured maximum size', {
          fieldErrors: {
            packageSpec: [`Archive size ${bytes} bytes exceeds limit ${maxArchiveBytes} bytes`],
          },
        });
      }

      const chunk = Buffer.from(value);
      if (!writeStream.write(chunk)) {
        await new Promise<void>((resolve, reject) => {
          writeStream.once('drain', resolve);
          writeStream.once('error', reject);
        });
      }
      const progressMb = Math.floor(bytes / (5 * 1024 * 1024));
      if (progressMb > lastProgressMb) {
        lastProgressMb = progressMb;
        context.emitProgress({
          message: `Downloading npm package tarball (${Math.max(1, Math.round(bytes / (1024 * 1024)))}MB so far)...`,
          level: 'info',
        });
      }
    }
    writeStream.end();
    await finished(writeStream);
  } catch (error) {
    writeStream.destroy();
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }

  return {
    path: archivePath,
    bytes,
    cleanup: async () => {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}

const definition = defineComponent({
  id: 'sentris.npm.package.source',
  label: 'NPM Package Source',
  category: 'security',
  runner: { kind: 'inline' },
  retryPolicy: npmPackageSourceRetryPolicy,
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Download the resolved installable npm package tarball into a scanner volume and emit package provenance.',
  toolProvider: {
    kind: 'component',
    name: 'npm_package_source',
    description: 'Download and extract an installable npm package tarball for source review.',
  },
  ui: {
    slug: 'npm-package-source',
    version: '1.0.0',
    type: 'process',
    category: 'security',
    description: 'Extract the installable npm package tarball for Semgrep and AI source review.',
    documentationUrl: 'https://docs.npmjs.com/cli/v10/commands/npm-view',
    icon: 'PackageOpen',
    author: {
      name: 'SentrisAI',
      type: 'sentris',
    },
    isLatest: true,
    deprecated: false,
    examples: [
      'Resolve source-map-js@1.2.1 to the npm registry tarball before SAST analysis.',
      'Prefer the installable package artifact over an unreleased repository branch.',
    ],
  },
  async execute({ inputs, params }, context) {
    const parsedParams = parameterSchema.parse(params);
    const parsedSpec = parsePackageSpec(inputs.packageSpec);

    context.emitProgress({
      message: `Resolving npm package ${parsedSpec.requestedSpec}`,
      level: 'info',
    });

    const registryUrl = npmMetadataUrl(parsedSpec.name);
    const metadataResponse = await context.http.fetch(registryUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!metadataResponse.ok) {
      throw new Error(
        `npm metadata fetch failed for ${parsedSpec.name}: ${metadataResponse.status} ${metadataResponse.statusText}`,
      );
    }
    const metadata = asRecord(await metadataResponse.json());
    const { resolvedVersion, resolution, versionRecord } = resolveVersion(parsedSpec, metadata);
    const dist = asRecord(versionRecord.dist);
    const tarballUrl = validateNpmTarballUrl(stringValue(dist.tarball) || '');
    const repositoryUrl =
      normalizeRepositoryUrl(versionRecord.repository) ||
      normalizeRepositoryUrl(metadata.repository);
    const publishedAt = stringValue(asRecord(metadata.time)[resolvedVersion]);

    context.emitProgress({
      message: `Downloading installable npm tarball ${parsedSpec.name}@${resolvedVersion}`,
      level: 'info',
      data: { tarballUrl },
    });

    const tarball = await fetchTarballToFile(context, tarballUrl, parsedParams.maxArchiveBytes);
    const tenantId = (context as { tenantId?: string }).tenantId ?? 'default-tenant';
    const volume = new IsolatedContainerVolume(tenantId, context.runId, { persist: true });

    try {
      await volume.initialize();
      await volume.extractTarGzArchiveFromPath(tarball.path, 'package.tgz');
      const volumeName = volume.getVolumeName();
      if (!volumeName) {
        throw new ValidationError('Failed to create npm package source volume', {
          fieldErrors: { packageSpec: ['Volume initialization did not return a name'] },
        });
      }

      const sourceBundleResult =
        parsedParams.emitSourceBundle === true
          ? extractSourceBundleFromFiles(
              listTarGzFiles(await readFile(tarball.path)),
              {
                maxFileBytes: parsedParams.maxFileBytes,
                maxTotalBytes: parsedParams.maxTotalBytes,
              },
              {
                archiveDescription: 'npm package tarball',
                excludedSegments: NPM_TARBALL_EXCLUDED_SEGMENTS,
                fieldName: 'packageSpec',
              },
            )
          : { sourceBundle: '', selectedFiles: 0, truncated: false };

      const packageProvenance = {
        sourceType: 'npm-tarball' as const,
        installable: true,
        packageName: parsedSpec.name,
        requestedSpec: parsedSpec.requestedSpec,
        requestedVersion: parsedSpec.version,
        resolvedVersion,
        resolution,
        tarballUrl,
        integrity: stringValue(dist.integrity),
        shasum: stringValue(dist.shasum),
        registryUrl,
        repositoryUrl,
        publishedAt,
      };
      const sourceStatus = {
        mode: 'npm-tarball-source' as const,
        sourceType: 'npm-tarball' as const,
        packageName: parsedSpec.name,
        requestedSpec: parsedSpec.requestedSpec,
        requestedVersion: parsedSpec.version,
        resolvedVersion,
        tarballUrl,
        repositoryUrl,
        publishedAt,
        sourceProvided: sourceBundleResult.sourceBundle.trim().length > 0,
        installable: true,
        selectedFiles: sourceBundleResult.selectedFiles,
        truncated: sourceBundleResult.truncated,
      };

      return {
        volumePath: PACKAGE_MOUNT_PATH,
        volumeName,
        packageName: parsedSpec.name,
        requestedVersion: parsedSpec.version,
        resolvedVersion,
        tarballUrl,
        sourceBundle: sourceBundleResult.sourceBundle,
        sourceStatus,
        packageProvenance,
      };
    } catch (error) {
      await volume.cleanup();
      throw error;
    } finally {
      await tarball.cleanup();
    }
  },
});

componentRegistry.register(definition);

export default definition;
