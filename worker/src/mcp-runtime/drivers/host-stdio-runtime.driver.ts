import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { McpResolvedRuntimeDefinitionSchema } from '@sentris/shared';

import type { McpClientFactory } from '../mcp-client-factory';
import type {
  HostStdioRuntimeDefinition,
  McpRuntimeDriver,
  McpRuntimeDriverHandle,
  McpRuntimeDriverStartInput,
  McpRuntimeResource,
} from '../mcp-runtime-driver';
import { resolveWindowsNpxCommand } from '../windows-npx-command';

const MAX_ARGS = 128;
const MAX_ARG_LENGTH = 8 * 1024;
const MAX_TOTAL_ARG_LENGTH = 64 * 1024;
const MAX_ENVIRONMENT_ENTRIES = 128;
const MAX_ENVIRONMENT_VALUE_LENGTH = 64 * 1024;
const MAX_ALLOWED_CWD_ROOTS = 32;

type McpClientFactoryPort = Pick<McpClientFactory, 'connect' | 'close'>;

export class HostStdioRuntimeDriver implements McpRuntimeDriver {
  readonly kinds = ['host-stdio'] as const;

  constructor(private readonly clientFactory: McpClientFactoryPort) {}

  async start(input: McpRuntimeDriverStartInput): Promise<McpRuntimeDriverHandle> {
    if (input.definition.kind !== 'host-stdio') {
      throw new Error(`Host stdio driver cannot start ${input.definition.kind}`);
    }
    assertConnectTimeout(input.connectTimeoutMs);
    const definition = validateDefinition(input.definition);
    const cwd = await resolveApprovedCwd(definition.cwd, definition.allowedCwdRoots);
    const launch = resolveWindowsNpxCommand({
      command: validateExecutable(definition.command),
      args: validateArgs(definition.args),
    });
    let closed = false;
    try {
      const owned = await this.clientFactory.connect({
        transport: 'stdio',
        command: validateExecutable(launch.command),
        args: validateArgs(launch.args),
        env: validateEnvironment(definition.environment),
        cwd,
        runtimeKey: input.runtimeKey,
        signal: input.signal,
        timeout: input.connectTimeoutMs,
      });
      return {
        adapter: owned.adapter,
        health: async () => (closed ? 'unhealthy' : 'unknown'),
        close: async () => {
          if (closed) return;
          closed = true;
          await this.clientFactory.close(input.runtimeKey);
        },
      };
    } catch (error: unknown) {
      await this.clientFactory.close(input.runtimeKey).catch(() => {});
      throw error;
    }
  }

  async inventory(): Promise<McpRuntimeResource[]> {
    return [];
  }

  async reap(_resource: McpRuntimeResource): Promise<void> {
    throw new Error('Host stdio runtimes do not own independently reapable resources');
  }
}

function validateDefinition(definition: HostStdioRuntimeDefinition): HostStdioRuntimeDefinition {
  const parsed = McpResolvedRuntimeDefinitionSchema.parse(definition);
  if (parsed.kind !== 'host-stdio') throw new Error('Expected an MCP host stdio definition');
  return parsed;
}

function validateExecutable(command: string): string {
  if (command.length === 0 || command.length > 4_096 || command.includes('\0')) {
    throw new Error('MCP stdio executable is invalid');
  }
  return command;
}

function validateArgs(args: string[] | undefined): string[] {
  if (args === undefined) return [];
  if (args.length > MAX_ARGS) throw new Error(`MCP stdio arguments exceed ${MAX_ARGS}`);
  let totalLength = 0;
  const validated = args.map((arg) => {
    if (arg.length > MAX_ARG_LENGTH || arg.includes('\0')) {
      throw new Error('MCP stdio argument is invalid');
    }
    totalLength += arg.length;
    return arg;
  });
  if (totalLength > MAX_TOTAL_ARG_LENGTH) {
    throw new Error(`MCP stdio arguments exceed ${MAX_TOTAL_ARG_LENGTH} characters`);
  }
  return validated;
}

function validateEnvironment(
  environment: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (environment === undefined) return undefined;
  const entries = Object.entries(environment);
  if (entries.length > MAX_ENVIRONMENT_ENTRIES) {
    throw new Error(`MCP stdio environment exceeds ${MAX_ENVIRONMENT_ENTRIES} entries`);
  }
  const result: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key)) {
      throw new Error(`Invalid MCP environment key: ${key}`);
    }
    if (value.length > MAX_ENVIRONMENT_VALUE_LENGTH || value.includes('\0')) {
      throw new Error(`Invalid MCP environment value for ${key}`);
    }
    result[key] = value;
  }
  return result;
}

async function resolveApprovedCwd(
  cwd: string | undefined,
  allowedRoots: string[] | undefined,
): Promise<string | undefined> {
  if (cwd === undefined) return undefined;
  if (!allowedRoots || allowedRoots.length === 0) {
    throw new Error('MCP stdio cwd requires at least one approved root');
  }
  if (allowedRoots.length > MAX_ALLOWED_CWD_ROOTS) {
    throw new Error(`MCP approved cwd roots exceed ${MAX_ALLOWED_CWD_ROOTS}`);
  }
  const canonicalCwd = await canonicalDirectory(cwd, 'cwd');
  const canonicalRoots = await Promise.all(
    allowedRoots.map((root) => canonicalDirectory(root, 'approved root')),
  );
  if (!canonicalRoots.some((root) => pathIsWithin(root, canonicalCwd))) {
    throw new Error('MCP stdio cwd is outside every approved root');
  }
  return canonicalCwd;
}

async function canonicalDirectory(input: string, label: string): Promise<string> {
  if (input.length === 0 || input.length > 4_096 || input.includes('\0')) {
    throw new Error(`MCP ${label} is invalid`);
  }
  const canonical = await realpath(resolve(input));
  const metadata = await stat(canonical);
  if (!metadata.isDirectory()) throw new Error(`MCP ${label} is not a directory`);
  return canonical;
}

function pathIsWithin(root: string, candidate: string): boolean {
  const normalizedRoot = process.platform === 'win32' ? root.toLowerCase() : root;
  const normalizedCandidate = process.platform === 'win32' ? candidate.toLowerCase() : candidate;
  const childPath = relative(normalizedRoot, normalizedCandidate);
  return (
    childPath === '' ||
    (childPath !== '..' && !childPath.startsWith(`..${sep}`) && !isAbsolute(childPath))
  );
}

function assertConnectTimeout(timeout: number): void {
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error('MCP runtime connect timeout must be finite and positive');
  }
}
