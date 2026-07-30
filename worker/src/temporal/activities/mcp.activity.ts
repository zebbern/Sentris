import {
  componentRegistry,
  getCredentialInputIds,
  isAgentCallable,
  getToolMetadata,
  ServiceError,
  resolveDockerResourceScope,
} from '@sentris/component-sdk';
import { ApplicationFailure } from '@temporalio/activity';
import {
  CleanupRunResourcesActivityInput,
  RegisterComponentToolActivityInput,
  RegisterLocalMcpActivityInput,
  RegisterRemoteMcpActivityInput,
  AreAllToolsReadyActivityInput,
  AreAllToolsReadyActivityOutput,
} from '../types';
import { workflowDiagnosticLog } from '../workflow-diagnostics';
import {
  isMcpStdioHostProxyId,
  stopMcpStdioHostProxy,
} from '../../components/core/mcp-stdio-host-proxy';
import { buildBackendApiUrl } from '../../common/backend-url';
import { cleanupManagedRunResources } from '../../utils/run-resource-cleanup';
import {
  MCP_DOCKER_PROXY_AUTH_HEADER,
  removeMcpDockerProxyRunTargets,
} from '../../components/core/mcp-docker-proxy';

export function buildInternalMcpUrl(baseUrl: string, path: string): string {
  return buildBackendApiUrl(`internal/mcp/${path}`, {
    SENTRIS_API_BASE_URL: baseUrl,
  });
}

async function callInternalApi(path: string, body: any) {
  const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
  if (!internalToken) {
    throw ApplicationFailure.nonRetryable(
      'INTERNAL_SERVICE_TOKEN env var must be set to call internal MCP registry',
      'ConfigurationError',
    );
  }

  const url = buildBackendApiUrl(`internal/mcp/${path}`);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Token': internalToken,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const raw = await response.text().catch(() => '<unable to read response body>');
    console.error(`[MCP Activity] API call failed: ${raw}`);
    throw new ServiceError(`Failed to call internal MCP registry (${path}): ${raw}`, {
      statusCode: response.status,
      details: { statusText: response.statusText },
    });
  }

  const result = await response.json();
  return result;
}

export async function registerComponentToolActivity(
  input: RegisterComponentToolActivityInput,
): Promise<void> {
  await callInternalApi('register-component', input);
}

export async function registerRemoteMcpActivity(
  input: RegisterRemoteMcpActivityInput,
): Promise<void> {
  await callInternalApi('register-mcp-server', {
    runId: input.runId,
    nodeId: input.nodeId,
    serverName: input.toolName,
    transport: 'http' as const,
    endpoint: input.endpoint,
    ...(input.authToken ? { headers: { Authorization: `Bearer ${input.authToken}` } } : {}),
  });
}

export async function registerLocalMcpActivity(
  input: RegisterLocalMcpActivityInput,
): Promise<void> {
  const port = input.port || 8080;
  const endpoint = input.endpoint || `http://localhost:${port}`;
  const containerId = input.containerId || `docker-${input.image.replace(/[^a-zA-Z0-9]/g, '-')}`;

  await callInternalApi('register-mcp-server', {
    runId: input.runId,
    nodeId: input.nodeId,
    serverName: input.toolName,
    transport: 'stdio' as const,
    endpoint,
    containerId,
    ...(input.authToken ? { headers: { [MCP_DOCKER_PROXY_AUTH_HEADER]: input.authToken } } : {}),
  });
}

// DEBUG: To disable container cleanup for inspecting Docker logs:
// Set environment variable: SKIP_CONTAINER_CLEANUP=true
// Or uncomment the line below:
// const SKIP_CLEANUP = true;
const SKIP_CONTAINER_CLEANUP = process.env.SKIP_CONTAINER_CLEANUP === 'true';

export async function cleanupRunResourcesActivity(
  input: CleanupRunResourcesActivityInput,
): Promise<void> {
  // DEBUG: Skip cleanup to inspect Docker logs
  if (SKIP_CONTAINER_CLEANUP) {
    console.log(
      `[MCP Cleanup] SKIP: Container cleanup disabled via SKIP_CONTAINER_CLEANUP env var`,
    );
    console.log(
      `[MCP Cleanup] Run 'docker ps -a | grep mcp' to see containers for run ${input.runId}`,
    );
    return;
  }

  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);

  // Get container IDs from tool registry (primary method)
  const response = (await callInternalApi('cleanup', { runId: input.runId })) as {
    containerIds?: string[];
  };
  const registryContainerIds = Array.isArray(response?.containerIds) ? response.containerIds : [];

  const report = await cleanupManagedRunResources({
    command: async (args) => execFileAsync('docker', args),
    runId: input.runId,
    resourceScope: resolveDockerResourceScope(),
    registryContainerIds,
    isHostProxyId: isMcpStdioHostProxyId,
    stopHostProxy: stopMcpStdioHostProxy,
  });
  const proxyTargetsRemoved = removeMcpDockerProxyRunTargets(input.runId);
  workflowDiagnosticLog(
    `[MCP Cleanup] Removed ${report.containersRemoved} container(s), ` +
      `${report.volumesRemoved} volume(s), and ${report.hostProxiesStopped} host proxy process(es) ` +
      `and ${proxyTargetsRemoved} Docker MCP proxy target(s) for run ${input.runId}`,
  );
}

export async function areAllToolsReadyActivity(
  input: AreAllToolsReadyActivityInput,
): Promise<AreAllToolsReadyActivityOutput> {
  const { runId, requiredNodeIds } = input;
  const response = await callInternalApi('tools-ready', {
    runId,
    requiredNodeIds,
  });
  return response as AreAllToolsReadyActivityOutput;
}

export async function prepareAndRegisterToolActivity(input: {
  runId: string;
  nodeId: string;
  componentId: string;
  inputs: Record<string, unknown>;
  params: Record<string, unknown>;
}): Promise<void> {
  const component = componentRegistry.get(input.componentId);
  if (!component) {
    throw new ServiceError(`Component ${input.componentId} not found`);
  }

  const metadata = getToolMetadata(component);
  const credentialIds = getCredentialInputIds(component);
  const exposedToAgent = isAgentCallable(component);

  // Extract credentials from inputs/params
  const allInputs = { ...input.inputs, ...input.params };
  const credentials: Record<string, unknown> = {};
  for (const id of credentialIds) {
    if (id in allInputs) {
      credentials[id] = allInputs[id];
    }
  }

  await callInternalApi('register-component', {
    runId: input.runId,
    nodeId: input.nodeId,
    toolName: metadata.name || input.nodeId.replace(/[^a-zA-Z0-9]/g, '_'),
    exposedToAgent,
    componentId: input.componentId,
    description: metadata.description,
    inputSchema: metadata.inputSchema,
    parameters: input.params,
    credentials,
  });
}
