import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runComponentWithRunner, ValidationError } from '@sentris/component-sdk';
import { getMcpDockerProxy, type McpDockerProxyRegistry } from './mcp-docker-proxy';

interface StartMcpServerInput {
  image: string;
  command?: string[];
  args?: string[];
  env?: Record<string, string>;
  port?: number;
  autoRemove?: boolean;
  volumes?: {
    source: string;
    target: string;
    readOnly?: boolean;
  }[];
  params: Record<string, unknown>;
  context: any;
}

interface StartMcpServerOutput {
  endpoint: string;
  authToken: string;
  containerId?: string;
}

interface McpRuntimeDeps {
  runComponent?: typeof runComponentWithRunner;
  dockerCommand?: (args: string[]) => Promise<{ stdout: string; stderr: string }>;
  proxy?: McpDockerProxyRegistry;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
}

const execFileAsync = promisify(execFile);

function parsePublishedPort(stdout: string): number {
  const ports = stdout
    .split(/\r?\n/)
    .map((line) => /:(\d+)\s*$/.exec(line)?.[1])
    .filter((value): value is string => Boolean(value))
    .map(Number);
  if (ports.length === 0 || ports.some((port) => !Number.isInteger(port) || port <= 0)) {
    throw new Error('Docker did not return an assigned MCP port');
  }
  if (ports.some((port) => port !== ports[0])) {
    throw new Error('Docker returned conflicting assigned MCP ports');
  }
  return ports[0]!;
}

export async function startMcpDockerServer(
  input: StartMcpServerInput,
  dependencies: McpRuntimeDeps = {},
): Promise<StartMcpServerOutput> {
  if (!input.image || input.image.trim().length === 0) {
    throw new ValidationError('Docker image is required for MCP server', {
      fieldErrors: { image: ['Docker image is required'] },
    });
  }
  const containerPort = input.port && input.port > 0 ? input.port : 8080;
  const now = dependencies.now ?? Date.now;

  // Use friendly container name for identification and inter-container DNS
  const containerName = `mcp-server-${input.image.replace(/[^a-zA-Z0-9]/g, '-')}-${now()}`;

  const runnerConfig = {
    kind: 'docker' as const,
    image: input.image,
    command: [...(input.command ?? []), ...(input.args ?? [])],
    env: {
      ...input.env,
      PORT: String(containerPort),
      // Add runId to env for container identification
      STUDIO_RUN_ID: input.context.runId || 'unknown',
    },
    network: 'bridge' as const,
    detached: true,
    // Explicitly disable autoRemove to ensure containers persist for manual cleanup
    // This prevents race conditions where containers are removed before cleanup runs
    autoRemove: false,
    containerName,
    // Bind to 0.0.0.0 so all interfaces can reach it (both localhost and Docker network)
    ports: { auto: containerPort },
    volumes: input.volumes,
  };

  const runComponent = dependencies.runComponent ?? runComponentWithRunner;
  const dockerCommand =
    dependencies.dockerCommand ??
    (async (args: string[]) => {
      const result = await execFileAsync('docker', args, { encoding: 'utf8' });
      return { stdout: result.stdout, stderr: result.stderr };
    });
  await runComponent(runnerConfig, async () => ({}), input.params, input.context);

  try {
    const { stdout } = await dockerCommand(['port', containerName, `${containerPort}/tcp`]);
    const assignedPort = parsePublishedPort(stdout);
    const dindHost = (dependencies.env ?? process.env).SENTRIS_DIND_HOST ?? 'dind';
    if (!/^[a-zA-Z0-9_.-]+$/.test(dindHost)) {
      throw new Error('SENTRIS_DIND_HOST is invalid');
    }
    const registration = (dependencies.proxy ?? getMcpDockerProxy()).registerTarget({
      containerId: containerName,
      runId: input.context.runId,
      targetOrigin: `http://${dindHost}:${assignedPort}`,
    });
    return {
      ...registration,
      containerId: containerName,
    };
  } catch (error: unknown) {
    await dockerCommand(['rm', '-f', containerName]).catch(() => undefined);
    throw error;
  }
}
