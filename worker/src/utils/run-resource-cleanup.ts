import {
  managedDockerLabelFilters,
  matchesManagedDockerLabels,
  type DockerResourceScope,
} from '@sentris/component-sdk';
import type { DockerCommand } from './orphan-reconciler';

const SAFE_DOCKER_ID = /^[a-zA-Z0-9_.-]+$/;
const SAFE_RUN_ID = /^[a-zA-Z0-9_.:-]{1,512}$/;

function outputLines(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function requireSafeDockerId(value: string, description: string): string {
  if (!SAFE_DOCKER_ID.test(value)) {
    throw new Error(`${description} is unsafe`);
  }
  return value;
}

function labelsFromContainer(value: Record<string, unknown>): unknown {
  return (value.Config as Record<string, unknown> | undefined)?.Labels;
}

export interface CleanupManagedRunResourcesOptions {
  command: DockerCommand;
  runId: string;
  resourceScope: DockerResourceScope;
  registryContainerIds: string[];
  isHostProxyId?: (id: string) => boolean;
  stopHostProxy?: (id: string) => Promise<boolean>;
  commandOptions?: { timeout?: number; env?: NodeJS.ProcessEnv };
}

export interface CleanupManagedRunResourcesReport {
  containersRemoved: number;
  volumesRemoved: number;
  hostProxiesStopped: number;
}

export async function cleanupManagedRunResources(
  options: CleanupManagedRunResourcesOptions,
): Promise<CleanupManagedRunResourcesReport> {
  if (!SAFE_RUN_ID.test(options.runId)) {
    throw new Error('runId is unsafe');
  }
  for (const id of options.registryContainerIds) {
    if (options.isHostProxyId?.(id)) continue;
    requireSafeDockerId(id, 'unsafe registry container ID');
  }

  const filters = managedDockerLabelFilters(options.resourceScope, options.runId);
  const [{ stdout: listedContainers }, { stdout: listedVolumes }] = await Promise.all([
    options.command(['ps', '-aq', ...filters], options.commandOptions),
    options.command(['volume', 'ls', '-q', ...filters], options.commandOptions),
  ]);
  const hostProxyIds = options.registryContainerIds.filter((id) => options.isHostProxyId?.(id));
  const listedContainerRefs = [...new Set(outputLines(listedContainers))].sort((left, right) =>
    left.localeCompare(right),
  );
  const registryContainerRefs = [
    ...new Set(options.registryContainerIds.filter((id) => !options.isHostProxyId?.(id))),
  ].sort((left, right) => left.localeCompare(right));
  const volumeIds = [...new Set(outputLines(listedVolumes))].sort((left, right) =>
    left.localeCompare(right),
  );

  listedContainerRefs.forEach((id) => requireSafeDockerId(id, 'managed container ID'));
  volumeIds.forEach((id) => requireSafeDockerId(id, 'managed volume ID'));

  const [listedContainerInspections, registryContainerInspections, volumes] = await Promise.all([
    listedContainerRefs.length > 0
      ? options
          .command(['inspect', ...listedContainerRefs], options.commandOptions)
          .then(({ stdout }) => JSON.parse(stdout) as Record<string, unknown>[])
      : [],
    Promise.all(
      registryContainerRefs.map(async (containerRef) => {
        const { stdout } = await options.command(['inspect', containerRef], options.commandOptions);
        const parsed = JSON.parse(stdout) as unknown;
        if (!Array.isArray(parsed) || parsed.length !== 1) {
          throw new Error(`Docker did not uniquely resolve registry container ${containerRef}`);
        }
        return parsed[0] as Record<string, unknown>;
      }),
    ),
    volumeIds.length > 0
      ? options
          .command(['volume', 'inspect', ...volumeIds], options.commandOptions)
          .then(({ stdout }) => JSON.parse(stdout) as Record<string, unknown>[])
      : [],
  ]);
  if (
    !Array.isArray(listedContainerInspections) ||
    listedContainerInspections.length !== listedContainerRefs.length
  ) {
    throw new Error('Docker did not return every managed container requested for validation');
  }
  if (!Array.isArray(volumes) || volumes.length !== volumeIds.length) {
    throw new Error('Docker did not return every managed volume requested for validation');
  }

  const validatedContainerIds = new Set<string>();
  for (const container of [...listedContainerInspections, ...registryContainerInspections]) {
    const id = requireSafeDockerId(String(container.Id), 'inspected container ID');
    if (
      !matchesManagedDockerLabels(
        labelsFromContainer(container),
        options.runId,
        options.resourceScope,
      )
    ) {
      throw new Error(`Managed container ${id} does not match the requested run and worker scope`);
    }
    validatedContainerIds.add(id);
  }

  const validatedVolumeIds = new Set<string>();
  for (const volume of volumes) {
    const id = requireSafeDockerId(String(volume.Name), 'inspected volume ID');
    if (!volumeIds.includes(id)) {
      throw new Error(`Docker returned unexpected volume ${id} during cleanup validation`);
    }
    if (!matchesManagedDockerLabels(volume.Labels, options.runId, options.resourceScope)) {
      throw new Error(`Managed volume ${id} does not match the requested run and worker scope`);
    }
    validatedVolumeIds.add(id);
  }
  if (validatedVolumeIds.size !== volumeIds.length) {
    throw new Error('Docker volume validation returned duplicate or missing resources');
  }

  await Promise.all(
    [...validatedContainerIds]
      .sort((left, right) => left.localeCompare(right))
      .map((id) => options.command(['rm', '-f', id], options.commandOptions).then(() => undefined)),
  );
  await Promise.all(
    volumeIds.map((id) =>
      options.command(['volume', 'rm', id], options.commandOptions).then(() => undefined),
    ),
  );
  let hostProxiesStopped = 0;
  for (const id of hostProxyIds) {
    if ((await options.stopHostProxy?.(id)) === true) hostProxiesStopped += 1;
  }

  return {
    containersRemoved: validatedContainerIds.size,
    volumesRemoved: volumeIds.length,
    hostProxiesStopped,
  };
}
