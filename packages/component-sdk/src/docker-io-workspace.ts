import { randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';
import { resolveDockerResourceScope, type DockerResourceScope } from './docker-resource-scope';

const OUTPUT_FILENAME = 'result.json';
const INPUT_FILENAME = 'input.json';
const SAFE_METADATA_RUN_ID = /^[^\0\r\n]{1,512}$/;

export interface CreateDockerIoWorkspaceOptions {
  runId: string;
  sharedRoot?: string;
  resourceScope?: DockerResourceScope;
}

export interface DockerIoWorkspace {
  resourceId: string;
  mountSource: string;
  inputPath: string;
  outputPath: string;
  cleanup(): Promise<void>;
}

interface ExchangeMetadata {
  managed: true;
  kind: 'component-io';
  resourceId: string;
  runId: string;
  deploymentId: string;
  instanceId: string;
  temporalNamespace: string;
  temporalTaskQueue: string;
  createdAt: string;
}

export async function createDockerIoWorkspace(
  options: CreateDockerIoWorkspaceOptions,
): Promise<DockerIoWorkspace> {
  if (!SAFE_METADATA_RUN_ID.test(options.runId)) {
    throw new Error('Docker I/O workspace runId contains unsupported characters');
  }

  if (!options.sharedRoot) {
    const mountSource = await mkdtemp(join(tmpdir(), 'sentris-run-'));
    return {
      resourceId: basename(mountSource),
      mountSource,
      inputPath: join(mountSource, INPUT_FILENAME),
      outputPath: join(mountSource, OUTPUT_FILENAME),
      cleanup: () => rm(mountSource, { recursive: true, force: true }),
    };
  }

  if (!isAbsolute(options.sharedRoot)) {
    throw new Error('SENTRIS_DOCKER_SHARED_IO_ROOT must be an absolute path');
  }

  const runsRoot = join(options.sharedRoot, 'runs');
  const metadataRoot = join(options.sharedRoot, 'metadata');
  await Promise.all([
    mkdir(runsRoot, { recursive: true }),
    mkdir(metadataRoot, { recursive: true }),
  ]);

  const resourceId = randomUUID();
  const mountSource = join(runsRoot, resourceId);
  const metadataPath = join(metadataRoot, `${resourceId}.json`);
  const metadata: ExchangeMetadata = {
    managed: true,
    kind: 'component-io',
    resourceId,
    runId: options.runId,
    ...(options.resourceScope ?? resolveDockerResourceScope()),
    createdAt: new Date().toISOString(),
  };

  try {
    // Publish management metadata first so a process exit can never leave an
    // untracked directory. A metadata-only record is safe for the reconciler
    // to remove after its normal age/active-run checks.
    await writeFile(metadataPath, JSON.stringify(metadata), {
      encoding: 'utf8',
      flag: 'wx',
    });
    await mkdir(mountSource);
    await chmod(mountSource, 0o777);
  } catch (error: unknown) {
    await rm(mountSource, { recursive: true, force: true }).catch(() => undefined);
    await rm(metadataPath, { force: true }).catch(() => undefined);
    throw error;
  }

  return {
    resourceId,
    mountSource,
    inputPath: join(mountSource, INPUT_FILENAME),
    outputPath: join(mountSource, OUTPUT_FILENAME),
    async cleanup() {
      await rm(mountSource, { recursive: true, force: true });
      await rm(metadataPath, { force: true });
    },
  };
}
