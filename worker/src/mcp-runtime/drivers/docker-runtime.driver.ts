import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DEFAULT_INHERITED_ENV_VARS } from '@modelcontextprotocol/client/stdio';
import {
  createDockerResourceScopeLabels,
  resolveDockerResourceScope,
  type DockerResourceScope,
} from '@sentris/component-sdk';
import {
  McpResolvedRuntimeDefinitionSchema,
  McpRuntimeFenceSchema,
  type McpRuntimeFence,
} from '@sentris/shared';

import type { McpClientFactory } from '../mcp-client-factory';
import type {
  DockerHttpRuntimeDefinition,
  DockerStdioRuntimeDefinition,
  McpRuntimeDriver,
  McpRuntimeDriverHandle,
  McpRuntimeDriverStartInput,
  McpRuntimeResource,
} from '../mcp-runtime-driver';
import { hashMcpRuntimeKey } from '../mcp-runtime-identity';
import { MCP_RUNTIME_MAX_DOCKER_INVENTORY } from '../mcp-runtime-limits';

const execFileAsync = promisify(execFile);
const DEFAULT_MAX_INVENTORY = 256;
const DEFAULT_DOCKER_COMMAND_TIMEOUT_MS = 15_000;
const INVENTORY_INSPECT_CONCURRENCY = 8;
const MAX_DOCKER_OUTPUT_BYTES = 256 * 1024;
const MAX_COMMAND_ARGS = 128;
const MAX_COMMAND_ARG_LENGTH = 8 * 1024;
const MAX_ENVIRONMENT_ENTRIES = 128;
const MAX_ENVIRONMENT_VALUE_LENGTH = 64 * 1024;
const DOCKER_CONTROL_ENVIRONMENT = [
  'DOCKER_HOST',
  'DOCKER_TLS_VERIFY',
  'DOCKER_CERT_PATH',
  'DOCKER_CONTEXT',
] as const;
const RESERVED_CONTAINER_ENVIRONMENT = new Set<string>(DOCKER_CONTROL_ENVIRONMENT);

const LABELS = {
  managed: 'sentris.mcp.managed',
  runtimeKeyHash: 'sentris.mcp.runtime-key-hash',
  runtimeId: 'sentris.mcp.runtime-id',
  ownerId: 'sentris.mcp.owner-id',
  ownerEpoch: 'sentris.mcp.owner-epoch',
  leaseGeneration: 'sentris.mcp.lease-generation',
} as const;

type McpClientFactoryPort = Pick<McpClientFactory, 'connect' | 'close'>;

export interface DockerCommandOptions {
  env: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs: number;
}

export type DockerCommand = (
  args: readonly string[],
  options: DockerCommandOptions,
) => Promise<{ stdout: string; stderr: string }>;

export interface DockerRuntimeDriverOptions {
  dockerCommand?: DockerCommand;
  environment?: NodeJS.ProcessEnv;
  resourceScope?: DockerResourceScope;
  maxInventory?: number;
  commandTimeoutMs?: number;
}

export class DockerRuntimeDriver implements McpRuntimeDriver {
  readonly kinds = ['docker-stdio', 'docker-http'] as const;

  private readonly dockerCommand: DockerCommand;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly resourceScopeLabels: Readonly<Record<string, string>>;
  private readonly maxInventory: number;
  private readonly commandTimeoutMs: number;

  constructor(
    private readonly clientFactory: McpClientFactoryPort,
    options: DockerRuntimeDriverOptions = {},
  ) {
    this.dockerCommand = options.dockerCommand ?? executeDockerCommand;
    this.environment = options.environment ?? process.env;
    this.resourceScopeLabels = Object.freeze(
      createDockerResourceScopeLabels(
        options.resourceScope ??
          resolveDockerResourceScope({
            SENTRIS_DEPLOYMENT_ID: this.environment.SENTRIS_DEPLOYMENT_ID,
            SENTRIS_INSTANCE: this.environment.SENTRIS_INSTANCE,
            TEMPORAL_NAMESPACE: this.environment.TEMPORAL_NAMESPACE,
            TEMPORAL_TASK_QUEUE: this.environment.TEMPORAL_TASK_QUEUE,
          }),
      ),
    );
    this.maxInventory = options.maxInventory ?? DEFAULT_MAX_INVENTORY;
    this.commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_DOCKER_COMMAND_TIMEOUT_MS;
    if (
      !Number.isInteger(this.maxInventory) ||
      this.maxInventory <= 0 ||
      this.maxInventory > MCP_RUNTIME_MAX_DOCKER_INVENTORY
    ) {
      throw new Error(
        `MCP Docker inventory limit must be an integer between 1 and ${MCP_RUNTIME_MAX_DOCKER_INVENTORY}`,
      );
    }
    if (
      !Number.isFinite(this.commandTimeoutMs) ||
      this.commandTimeoutMs <= 0 ||
      this.commandTimeoutMs > 60_000
    ) {
      throw new Error('MCP Docker command timeout must be between 1 and 60000ms');
    }
  }

  async start(input: McpRuntimeDriverStartInput): Promise<McpRuntimeDriverHandle> {
    if (input.definition.kind === 'docker-stdio') {
      return this.startStdio(input, input.definition);
    }
    if (input.definition.kind === 'docker-http') {
      return this.startHttp(input, input.definition);
    }
    throw new Error(`Docker driver cannot start ${input.definition.kind}`);
  }

  async inventory(): Promise<McpRuntimeResource[]> {
    const ids = await this.listContainerIds(
      labelFilterArgs({ [LABELS.managed]: 'true', ...this.resourceScopeLabels }),
    );
    const resources: McpRuntimeResource[] = [];
    for (let offset = 0; offset < ids.length; offset += INVENTORY_INSPECT_CONCURRENCY) {
      const inspected = await Promise.all(
        ids.slice(offset, offset + INVENTORY_INSPECT_CONCURRENCY).map(async (id) => ({
          id,
          labels: await this.inspectLabels(id).catch(() => undefined),
        })),
      );
      for (const { id, labels } of inspected) {
        if (!labels) continue;
        const resource = parseResource(id, labels, this.resourceScopeLabels);
        if (resource) resources.push(resource);
      }
    }
    return resources.sort((left, right) =>
      left.resourceId < right.resourceId ? -1 : left.resourceId > right.resourceId ? 1 : 0,
    );
  }

  async reap(resource: McpRuntimeResource): Promise<void> {
    const expected = validateResource(resource);
    const labels = await this.inspectLabels(expected.resourceId).catch(() => undefined);
    if (!labels) return;
    const actual = parseResource(expected.resourceId, labels, this.resourceScopeLabels);
    if (!actual || !resourcesMatch(actual, expected)) {
      throw new Error('Refusing to reap an MCP Docker resource whose fence labels changed');
    }
    await this.runDocker(['rm', '-f', expected.resourceId]);
  }

  private async startStdio(
    input: McpRuntimeDriverStartInput,
    definitionInput: DockerStdioRuntimeDefinition,
  ): Promise<McpRuntimeDriverHandle> {
    assertConnectTimeout(input.connectTimeoutMs);
    const definition = validateDockerStdioDefinition(definitionInput);
    const labels = createFenceLabels(input.runtimeKey, input.fence, this.resourceScopeLabels);
    const containerEnvironment = validateEnvironment(definition.environment);
    const dockerEnvironment = this.createDockerEnvironment(containerEnvironment);
    const dockerArgs = [
      'run',
      '--rm',
      '-i',
      ...labelArgs(labels),
      ...dockerContainerOptionArgs(definition, containerEnvironment),
      definition.image,
      ...validateCommand(definition.command),
    ];
    let resource: McpRuntimeResource | undefined;
    let closed = false;
    try {
      const owned = await this.clientFactory.connect({
        transport: 'stdio',
        command: 'docker',
        args: dockerArgs,
        env: dockerEnvironment,
        runtimeKey: input.runtimeKey,
        signal: input.signal,
        timeout: input.connectTimeoutMs,
      });
      const ids = await this.listExactFenceContainerIds(labels, input.signal);
      if (ids.length !== 1) {
        throw new Error(`Expected one persistent MCP stdio container, found ${ids.length}`);
      }
      resource = createResource(ids[0]!, input.runtimeKey, input.fence);
      return {
        adapter: owned.adapter,
        resource,
        health: async () => (closed ? 'unhealthy' : this.containerHealth(resource!.resourceId)),
        close: async () => {
          if (closed) return;
          closed = true;
          await this.removeContainer(resource!.resourceId).finally(async () => {
            await this.clientFactory.close(input.runtimeKey);
          });
        },
      };
    } catch (error: unknown) {
      await this.clientFactory.close(input.runtimeKey).catch(() => {});
      const ids = resource
        ? [resource.resourceId]
        : await this.listExactFenceContainerIds(labels, undefined, true).catch(() => []);
      await Promise.allSettled(ids.map((id) => this.removeContainer(id)));
      throw error;
    }
  }

  private async startHttp(
    input: McpRuntimeDriverStartInput,
    definitionInput: DockerHttpRuntimeDefinition,
  ): Promise<McpRuntimeDriverHandle> {
    assertConnectTimeout(input.connectTimeoutMs);
    const definition = validateDockerHttpDefinition(definitionInput);
    const labels = createFenceLabels(input.runtimeKey, input.fence, this.resourceScopeLabels);
    const containerEnvironment = validateEnvironment(definition.environment);
    const dockerEnvironment = this.createDockerEnvironment(containerEnvironment);
    const runArgs = [
      'run',
      '-d',
      ...labelArgs(labels),
      '--publish',
      String(definition.containerPort),
      ...dockerContainerOptionArgs(definition, containerEnvironment),
      definition.image,
      ...validateCommand(definition.command),
    ];
    let containerId: string | undefined;
    let closed = false;
    try {
      const launched = await this.runDocker(runArgs, dockerEnvironment, input.signal);
      containerId = parseSingleContainerId(launched.stdout);
      const portResult = await this.runDocker(
        ['port', containerId, `${definition.containerPort}/tcp`],
        undefined,
        input.signal,
      );
      const publishedPort = parsePublishedPort(portResult.stdout);
      const dindHost = validateDindHost(
        definition.dindHost ?? this.environment.SENTRIS_DIND_HOST ?? 'dind',
      );
      const endpoint = createContainerEndpoint(dindHost, publishedPort, definition.endpointPath);
      const owned = await this.clientFactory.connect({
        transport: 'http',
        endpoint,
        runtimeKey: input.runtimeKey,
        signal: input.signal,
        timeout: input.connectTimeoutMs,
      });
      const resource = createResource(containerId, input.runtimeKey, input.fence);
      return {
        adapter: owned.adapter,
        resource,
        health: async () => (closed ? 'unhealthy' : this.containerHealth(containerId!)),
        close: async () => {
          if (closed) return;
          closed = true;
          await this.clientFactory.close(input.runtimeKey).finally(async () => {
            await this.removeContainer(containerId!);
          });
        },
      };
    } catch (error: unknown) {
      await this.clientFactory.close(input.runtimeKey).catch(() => {});
      if (containerId) await this.removeContainer(containerId).catch(() => {});
      throw error;
    }
  }

  private async containerHealth(resourceId: string): Promise<'healthy' | 'unhealthy' | 'unknown'> {
    try {
      const result = await this.runDocker([
        'inspect',
        '--format',
        '{{json .State.Running}}',
        resourceId,
      ]);
      const state = result.stdout.trim();
      if (state === 'true') return 'healthy';
      if (state === 'false') return 'unhealthy';
      return 'unknown';
    } catch {
      return 'unhealthy';
    }
  }

  private async listExactFenceContainerIds(
    labels: Record<string, string>,
    signal?: AbortSignal,
    includeStopped = false,
  ): Promise<string[]> {
    return this.listContainerIds(
      Object.entries(labels).flatMap(([key, value]) => ['--filter', `label=${key}=${value}`]),
      signal,
      includeStopped,
    );
  }

  private async listContainerIds(
    filterArgs: readonly string[],
    signal?: AbortSignal,
    includeStopped = true,
  ): Promise<string[]> {
    const result = await this.runDocker(
      ['ps', includeStopped ? '-aq' : '-q', ...filterArgs],
      undefined,
      signal,
    );
    const ids = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
      .slice(0, this.maxInventory + 1);
    return ids.map(validateContainerId);
  }

  private async inspectLabels(resourceId: string): Promise<Record<string, string>> {
    const id = validateContainerId(resourceId);
    const result = await this.runDocker(['inspect', '--format', '{{json .Config.Labels}}', id]);
    if (result.stdout.length > 16 * 1024) throw new Error('MCP Docker labels exceed size limit');
    const parsed: unknown = JSON.parse(result.stdout);
    if (!isStringRecord(parsed) || Object.keys(parsed).length > 64) {
      throw new Error('MCP Docker labels are invalid');
    }
    for (const [key, value] of Object.entries(parsed)) {
      if (key.length > 256 || value.length > 4_096 || key.includes('\0') || value.includes('\0')) {
        throw new Error('MCP Docker labels are invalid');
      }
    }
    return parsed;
  }

  private async removeContainer(resourceId: string): Promise<void> {
    await this.runDocker(['rm', '-f', validateContainerId(resourceId)]);
  }

  private createDockerEnvironment(
    containerEnvironment: Record<string, string>,
  ): Record<string, string> {
    const result: Record<string, string> = {};
    for (const key of [...DEFAULT_INHERITED_ENV_VARS, ...DOCKER_CONTROL_ENVIRONMENT]) {
      const value = this.environment[key];
      if (value !== undefined && !value.startsWith('()')) result[key] = value;
    }
    return { ...result, ...containerEnvironment };
  }

  private runDocker(
    args: readonly string[],
    env = this.createDockerEnvironment({}),
    signal?: AbortSignal,
  ): Promise<{ stdout: string; stderr: string }> {
    return this.dockerCommand(args, {
      env,
      signal,
      timeoutMs: this.commandTimeoutMs,
    });
  }
}

async function executeDockerCommand(
  args: readonly string[],
  options: DockerCommandOptions,
): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync('docker', [...args], {
    encoding: 'utf8',
    env: options.env,
    signal: options.signal,
    timeout: options.timeoutMs,
    maxBuffer: MAX_DOCKER_OUTPUT_BYTES,
    windowsHide: true,
  });
  return { stdout: String(result.stdout), stderr: String(result.stderr) };
}

function validateDockerStdioDefinition(
  definition: DockerStdioRuntimeDefinition,
): DockerStdioRuntimeDefinition {
  const parsed = McpResolvedRuntimeDefinitionSchema.parse(definition);
  if (parsed.kind !== 'docker-stdio') throw new Error('Expected an MCP Docker stdio definition');
  validateDockerFields(parsed);
  return parsed;
}

function validateDockerHttpDefinition(
  definition: DockerHttpRuntimeDefinition,
): DockerHttpRuntimeDefinition {
  const parsed = McpResolvedRuntimeDefinitionSchema.parse(definition);
  if (parsed.kind !== 'docker-http') throw new Error('Expected an MCP Docker HTTP definition');
  validateDockerFields(parsed);
  if (
    !Number.isInteger(parsed.containerPort) ||
    parsed.containerPort <= 0 ||
    parsed.containerPort > 65_535
  ) {
    throw new Error('MCP Docker HTTP container port must be between 1 and 65535');
  }
  if (parsed.dindHost !== undefined) validateDindHost(parsed.dindHost);
  if (parsed.endpointPath !== undefined) validateEndpointPath(parsed.endpointPath);
  return parsed;
}

function validateDockerFields(
  definition: DockerStdioRuntimeDefinition | DockerHttpRuntimeDefinition,
): void {
  validateImage(definition.image);
  validateCommand(definition.command);
  validateEnvironment(definition.environment);
  if (definition.network !== undefined) validateNetwork(definition.network);
}

function validateImage(image: string): string {
  if (
    image.length === 0 ||
    image.length > 512 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,511}$/.test(image)
  ) {
    throw new Error('Invalid MCP Docker image reference');
  }
  return image;
}

function validateCommand(command: string[] | undefined): string[] {
  if (command === undefined) return [];
  if (command.length > MAX_COMMAND_ARGS) {
    throw new Error(`MCP Docker command exceeds ${MAX_COMMAND_ARGS} arguments`);
  }
  return command.map((argument) => {
    if (argument.length > MAX_COMMAND_ARG_LENGTH || argument.includes('\0')) {
      throw new Error('Invalid MCP Docker command argument');
    }
    return argument;
  });
}

function validateEnvironment(
  environment: Record<string, string> | undefined,
): Record<string, string> {
  if (environment === undefined) return {};
  const entries = Object.entries(environment);
  if (entries.length > MAX_ENVIRONMENT_ENTRIES) {
    throw new Error(`MCP Docker environment exceeds ${MAX_ENVIRONMENT_ENTRIES} entries`);
  }
  const result: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key)) {
      throw new Error(`Invalid MCP Docker environment key: ${key}`);
    }
    if (RESERVED_CONTAINER_ENVIRONMENT.has(key)) {
      throw new Error(`MCP container environment may not override Docker client variable ${key}`);
    }
    if (value.length > MAX_ENVIRONMENT_VALUE_LENGTH || value.includes('\0')) {
      throw new Error(`Invalid MCP Docker environment value for ${key}`);
    }
    result[key] = value;
  }
  return result;
}

function createFenceLabels(
  runtimeKey: McpRuntimeDriverStartInput['runtimeKey'],
  fenceInput: McpRuntimeFence,
  resourceScopeLabels: Readonly<Record<string, string>>,
): Record<string, string> {
  const fence = McpRuntimeFenceSchema.parse(fenceInput);
  const ownerId = validateLabelValue(fence.ownerId, 'owner ID');
  return {
    [LABELS.managed]: 'true',
    [LABELS.runtimeKeyHash]: hashMcpRuntimeKey(runtimeKey),
    [LABELS.runtimeId]: fence.runtimeId,
    [LABELS.ownerId]: ownerId,
    [LABELS.ownerEpoch]: fence.ownerEpoch,
    [LABELS.leaseGeneration]: String(fence.leaseGeneration),
    ...resourceScopeLabels,
  };
}

function labelArgs(labels: Record<string, string>): string[] {
  return Object.entries(labels).flatMap(([key, value]) => ['--label', `${key}=${value}`]);
}

function labelFilterArgs(labels: Readonly<Record<string, string>>): string[] {
  return Object.entries(labels).flatMap(([key, value]) => ['--filter', `label=${key}=${value}`]);
}

function environmentArgs(environment: Record<string, string>): string[] {
  return Object.keys(environment)
    .sort()
    .flatMap((key) => ['--env', key]);
}

function dockerContainerOptionArgs(
  definition: DockerStdioRuntimeDefinition | DockerHttpRuntimeDefinition,
  environment: Record<string, string>,
): string[] {
  return [
    ...networkArgs(definition.network),
    ...environmentArgs(environment),
    ...repeatDockerOption('--volume', definition.volumes),
    ...repeatDockerOption('--mount', definition.mounts),
    ...dockerValueOption('--workdir', definition.workingDirectory),
    ...dockerValueOption('--user', definition.user),
    ...dockerValueOption('--entrypoint', definition.entrypoint),
    ...(definition.readOnlyRootFilesystem ? ['--read-only'] : []),
    ...(definition.init ? ['--init'] : []),
  ];
}

function repeatDockerOption(option: string, values: readonly string[] | undefined): string[] {
  return values?.flatMap((value) => [option, value]) ?? [];
}

function dockerValueOption(option: string, value: string | undefined): string[] {
  return value === undefined ? [] : [option, value];
}

function networkArgs(network: string | undefined): string[] {
  return network === undefined ? [] : ['--network', validateNetwork(network)];
}

function validateNetwork(network: string): string {
  if (
    network.length === 0 ||
    network.length > 255 ||
    !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(network)
  ) {
    throw new Error('Invalid MCP Docker network');
  }
  return network;
}

function validateDindHost(host: string): string {
  if (host.length === 0 || host.length > 253 || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(host)) {
    throw new Error('Invalid SENTRIS_DIND_HOST for MCP runtime');
  }
  return host;
}

function createContainerEndpoint(host: string, port: number, path: string | undefined): URL {
  const endpointPath = path === undefined ? '/mcp' : validateEndpointPath(path);
  const base = new URL(`http://${host}:${port}`);
  const endpoint = new URL(endpointPath, base);
  if (endpoint.origin !== base.origin) throw new Error('MCP Docker endpoint path changed origin');
  return endpoint;
}

function validateEndpointPath(path: string): string {
  if (
    path.length === 0 ||
    path.length > 2_048 ||
    !path.startsWith('/') ||
    path.startsWith('//') ||
    path.includes('\0') ||
    path.includes('#')
  ) {
    throw new Error('Invalid MCP Docker endpoint path');
  }
  return path;
}

function parsePublishedPort(stdout: string): number {
  if (stdout.length > 8 * 1024) throw new Error('Docker port output exceeds size limit');
  const ports = stdout
    .split(/\r?\n/)
    .map((line) => /:(\d+)\s*$/.exec(line)?.[1])
    .filter((value): value is string => value !== undefined)
    .map(Number);
  if (
    ports.length === 0 ||
    ports.some((port) => !Number.isInteger(port) || port <= 0 || port > 65_535) ||
    ports.some((port) => port !== ports[0])
  ) {
    throw new Error('Docker did not return one valid assigned MCP port');
  }
  return ports[0]!;
}

function parseSingleContainerId(stdout: string): string {
  const values = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (values.length !== 1) throw new Error('Docker did not return one MCP container ID');
  return validateContainerId(values[0]!);
}

function validateContainerId(value: string): string {
  if (!/^[a-f0-9]{12,64}$/.test(value)) throw new Error('Invalid MCP Docker container ID');
  return value;
}

function validateLabelValue(value: string, label: string): string {
  if (!isValidLabelValue(value)) {
    throw new Error(`Invalid MCP Docker ${label} label`);
  }
  return value;
}

function parseResource(
  resourceId: string,
  labels: Record<string, string>,
  expectedResourceScopeLabels: Readonly<Record<string, string>>,
): McpRuntimeResource | undefined {
  if (labels[LABELS.managed] !== 'true') return undefined;
  if (Object.entries(expectedResourceScopeLabels).some(([key, value]) => labels[key] !== value)) {
    return undefined;
  }
  const runtimeKeyHash = labels[LABELS.runtimeKeyHash];
  const runtimeId = labels[LABELS.runtimeId];
  const ownerId = labels[LABELS.ownerId];
  const ownerEpoch = labels[LABELS.ownerEpoch];
  const rawGeneration = labels[LABELS.leaseGeneration];
  if (
    !runtimeKeyHash ||
    !/^[a-f0-9]{64}$/.test(runtimeKeyHash) ||
    !runtimeId ||
    !ownerId ||
    !isValidLabelValue(ownerId) ||
    !ownerEpoch ||
    !rawGeneration ||
    !/^\d+$/.test(rawGeneration)
  ) {
    return undefined;
  }
  const fence = McpRuntimeFenceSchema.safeParse({
    runtimeId,
    ownerId,
    ownerEpoch,
    leaseGeneration: Number(rawGeneration),
  });
  if (!fence.success) return undefined;
  return {
    kind: 'docker-container',
    resourceId: validateContainerId(resourceId),
    runtimeKeyHash,
    fence: fence.data,
  };
}

function isValidLabelValue(value: string): boolean {
  return value.length > 0 && value.length <= 128 && /^[A-Za-z0-9_.:@/+-]+$/.test(value);
}

function createResource(
  resourceId: string,
  runtimeKey: McpRuntimeDriverStartInput['runtimeKey'],
  fence: McpRuntimeFence,
): McpRuntimeResource {
  return {
    kind: 'docker-container',
    resourceId: validateContainerId(resourceId),
    runtimeKeyHash: hashMcpRuntimeKey(runtimeKey),
    fence: McpRuntimeFenceSchema.parse(fence),
  };
}

function validateResource(resource: McpRuntimeResource): McpRuntimeResource {
  if (resource.kind !== 'docker-container' || !/^[a-f0-9]{64}$/.test(resource.runtimeKeyHash)) {
    throw new Error('Invalid MCP Docker resource');
  }
  return {
    ...resource,
    resourceId: validateContainerId(resource.resourceId),
    fence: McpRuntimeFenceSchema.parse(resource.fence),
  };
}

function resourcesMatch(left: McpRuntimeResource, right: McpRuntimeResource): boolean {
  return (
    left.resourceId === right.resourceId &&
    left.runtimeKeyHash === right.runtimeKeyHash &&
    left.fence.runtimeId === right.fence.runtimeId &&
    left.fence.ownerId === right.fence.ownerId &&
    left.fence.ownerEpoch === right.fence.ownerEpoch &&
    left.fence.leaseGeneration === right.fence.leaseGeneration
  );
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === 'string')
  );
}

function assertConnectTimeout(timeout: number): void {
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error('MCP runtime connect timeout must be finite and positive');
  }
}
