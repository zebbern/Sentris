/**
 * Deterministic smoke test for MCP tools exposed to agent nodes.
 *
 * Usage:
 *   SENTRIS_INSTANCE=0 bun scripts/smoke-mcp-agent-tools.ts
 *
 * Optional:
 *   SENTRIS_API_BASE=http://127.0.0.1:3211/api/v1
 *   SMOKE_KEEP_WORKFLOW=true
 */
import { readActiveInstance } from './lib/local-script-runtime';

const activeInstance = readActiveInstance();
const backendPort = 3211 + Number(activeInstance.instance) * 100;
const API_BASE = process.env.SENTRIS_API_BASE ?? `http://127.0.0.1:${backendPort}/api/v1`;
const INTERNAL_TOKEN = process.env.SENTRIS_INTERNAL_TOKEN ?? 'local-internal-token';
const ORG_ID = process.env.SENTRIS_ORG_ID ?? 'local-dev';
const KEEP_WORKFLOW = process.env.SMOKE_KEEP_WORKFLOW === 'true';
const RUN_TIMEOUT_MS = Number.parseInt(process.env.SMOKE_RUN_TIMEOUT_MS ?? '300000', 10);
const POLL_MS = 2000;

const headers = {
  'Content-Type': 'application/json',
  'x-internal-token': INTERNAL_TOKEN,
  'x-organization-id': ORG_ID,
};

interface CreatedMcpServer {
  id: string;
  name: string;
}

interface RunStatus {
  status: string;
  error?: string;
}

interface WorkflowCreateResponse {
  id: string;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...headers, ...init?.headers },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${init?.method ?? 'GET'} ${path} failed: ${response.status} ${text}`);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

async function ensureBackendReady(): Promise<void> {
  const healthUrl = `${API_BASE.replace(/\/api\/v1$/, '')}/health`;
  const response = await fetch(healthUrl, { headers });
  if (!response.ok) {
    throw new Error(`Backend health check failed at ${healthUrl}: ${response.status}`);
  }
}

function buildWorkflow(serverId: string, suffix: string) {
  return {
    name: `Smoke: MCP Agent Tools ${suffix}`,
    nodes: [
      {
        id: 'start',
        type: 'core.workflow.entrypoint',
        position: { x: 0, y: 0 },
        data: {
          label: 'Start',
          config: {
            params: {
              runtimeInputs: [{ id: 'trigger', label: 'Trigger', type: 'string' }],
            },
            inputOverrides: {},
          },
        },
      },
      {
        id: 'custom-mcp',
        type: 'mcp.custom',
        position: { x: 280, y: -80 },
        data: {
          label: 'Fetch MCP',
          config: {
            mode: 'tool',
            params: {
              enabledServers: [serverId],
              useAllEnabled: false,
              continueOnServerError: false,
            },
            inputOverrides: {},
          },
        },
      },
      {
        id: 'mock-agent',
        type: 'mock.agent',
        position: { x: 560, y: 0 },
        data: {
          label: 'Mock Agent',
          config: {
            params: { callTools: true, maxToolCalls: 1 },
            inputOverrides: {},
          },
        },
      },
      {
        id: 'build-report',
        type: 'core.logic.script',
        position: { x: 840, y: 0 },
        data: {
          label: 'Build MCP Evidence Report',
          config: {
            params: {
              variables: [
                { name: 'toolCallResults', type: 'json' },
                { name: 'toolCount', type: 'number' },
              ],
              returns: [{ name: 'reportMarkdown', type: 'string' }],
              code: `export function script(input) {
  const calls = Array.isArray(input.toolCallResults) ? input.toolCallResults : [];
  const fetchCall = calls.find((call) => String(call.toolName || '').endsWith('__fetch')) || calls[0] || {};
  const output = fetchCall.output == null ? '' : String(fetchCall.output);
  const status = fetchCall.success === true ? 'succeeded' : 'failed';
  return {
    reportMarkdown: [
      '# MCP Agent Tool Smoke Report',
      '',
      '## External MCP Evidence Used',
      '',
      '- Tool: ' + String(fetchCall.toolName || 'fetch'),
      '- Input: https://example.com',
      '- Result: ' + status + (output ? ' - ' + output.slice(0, 200).replace(/\\s+/g, ' ') : ''),
      '- Affected findings: none; this validates agent MCP tool wiring without claiming a vulnerability.',
      '',
      'Discovered tool count: ' + String(input.toolCount || 0)
    ].join('\\n')
  };
}`,
            },
            inputOverrides: {},
          },
        },
      },
      {
        id: 'artifact',
        type: 'core.artifact.writer',
        position: { x: 1120, y: 0 },
        data: {
          label: 'Save Report',
          config: {
            params: {
              fileExtension: '.md',
              mimeType: 'text/markdown',
              saveToRunArtifacts: true,
              publishToArtifactLibrary: false,
            },
            inputOverrides: { artifactName: 'mcp-agent-tool-smoke' },
          },
        },
      },
    ],
    edges: [
      { id: 'start-agent', source: 'start', target: 'mock-agent' },
      {
        id: 'mcp-agent-tools',
        source: 'custom-mcp',
        target: 'mock-agent',
        sourceHandle: 'tools',
        targetHandle: 'tools',
      },
      {
        id: 'agent-report-results',
        source: 'mock-agent',
        target: 'build-report',
        sourceHandle: 'toolCallResults',
        targetHandle: 'toolCallResults',
      },
      {
        id: 'agent-report-count',
        source: 'mock-agent',
        target: 'build-report',
        sourceHandle: 'toolCount',
        targetHandle: 'toolCount',
      },
      {
        id: 'report-artifact',
        source: 'build-report',
        target: 'artifact',
        sourceHandle: 'reportMarkdown',
        targetHandle: 'content',
      },
    ],
  };
}

async function pollRun(runId: string): Promise<RunStatus> {
  const deadline = Date.now() + RUN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const status = await api<RunStatus>(`/workflows/runs/${runId}/status`);
    console.log(`Run ${runId}: ${status.status}`);
    if (['COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'TERMINATED'].includes(status.status)) {
      return status;
    }
    await Bun.sleep(POLL_MS);
  }
  throw new Error(`Run ${runId} timed out after ${RUN_TIMEOUT_MS}ms`);
}

async function main(): Promise<void> {
  console.log(
    `Target instance: ${activeInstance.instance} via ${activeInstance.source}; API=${API_BASE}`,
  );
  await ensureBackendReady();

  const suffix = Date.now().toString();
  let serverId: string | null = null;
  let workflowId: string | null = null;

  try {
    const server = await api<CreatedMcpServer>('/mcp-servers', {
      method: 'POST',
      body: JSON.stringify({
        name: `smoke-fetch-reference-${suffix}`,
        description: 'Temporary Fetch MCP server for deterministic agent gateway smoke testing',
        transportType: 'stdio',
        command: 'docker',
        args: ['run', '-i', '--rm', 'mcp/fetch'],
        enabled: true,
      }),
    });
    serverId = server.id;
    console.log(`Created temporary MCP server ${server.name} (${server.id})`);

    const connection = await api<{ success: boolean; message?: string; toolCount?: number }>(
      `/mcp-servers/${server.id}/test`,
      { method: 'POST' },
    );
    if (!connection.success || (connection.toolCount ?? 0) < 1) {
      throw new Error(
        `Fetch MCP connection test failed: ${connection.message ?? 'no message'}; tools=${
          connection.toolCount ?? 0
        }`,
      );
    }
    console.log(`Fetch MCP connection ready: ${connection.message}`);

    const workflow = await api<WorkflowCreateResponse>('/workflows', {
      method: 'POST',
      body: JSON.stringify(buildWorkflow(server.id, suffix)),
    });
    workflowId = workflow.id;
    console.log(`Created smoke workflow ${workflowId}`);

    const started = await api<{ runId: string }>(`/workflows/${workflow.id}/run`, {
      method: 'POST',
      body: JSON.stringify({ inputs: { trigger: 'mcp-agent-tools-smoke' } }),
    });
    console.log(`Started run ${started.runId}`);

    const status = await pollRun(started.runId);
    if (status.status !== 'COMPLETED') {
      throw new Error(`Run ended with ${status.status}: ${status.error ?? 'no error message'}`);
    }

    const result = await api<any>(`/workflows/runs/${started.runId}/result`);
    const toolCalls = result?.result?.outputs?.['mock-agent']?.toolCallResults ?? [];
    const fetchCall = Array.isArray(toolCalls)
      ? toolCalls.find((call) => String(call.toolName || '').endsWith('__fetch'))
      : null;
    if (!fetchCall?.success) {
      throw new Error(`Expected successful Fetch MCP tool call, got ${JSON.stringify(fetchCall)}`);
    }
    if (!String(fetchCall.output ?? '').includes('Example Domain')) {
      throw new Error('Fetch MCP output did not contain Example Domain');
    }

    const reportMarkdown = result?.result?.outputs?.['build-report']?.reportMarkdown;
    if (
      typeof reportMarkdown !== 'string' ||
      !reportMarkdown.includes('## External MCP Evidence Used') ||
      !reportMarkdown.includes('Example Domain')
    ) {
      throw new Error('Markdown report missing expected MCP evidence section');
    }

    console.log('MCP agent tool smoke passed: Fetch tool returned Example Domain.');
  } finally {
    if (!KEEP_WORKFLOW && workflowId) {
      await api(`/workflows/${workflowId}`, { method: 'DELETE' }).catch(() => undefined);
      console.log(`Deleted smoke workflow ${workflowId}`);
    }
    if (!KEEP_WORKFLOW && serverId) {
      await api(`/mcp-servers/${serverId}`, { method: 'DELETE' }).catch(() => undefined);
      console.log(`Deleted temporary MCP server ${serverId}`);
    }
    if (KEEP_WORKFLOW) {
      console.log('Keeping smoke records because SMOKE_KEEP_WORKFLOW=true');
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
