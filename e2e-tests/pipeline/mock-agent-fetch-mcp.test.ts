import { expect, afterAll } from 'bun:test';

import {
  API_BASE,
  HEADERS,
  createMcpServer,
  createWorkflow,
  deleteMcpServer,
  deleteWorkflowById,
  e2eDescribe,
  e2eTest,
  getTraceEvents,
  pollRunStatus,
  runWorkflow,
  testMcpServerConnection,
} from '../helpers/e2e-harness';

e2eDescribe('Mock Agent: Fetch MCP E2E', () => {
  const createdServerIds: string[] = [];
  const createdWorkflowIds: string[] = [];

  afterAll(async () => {
    for (const workflowId of createdWorkflowIds.splice(0)) {
      await deleteWorkflowById(workflowId).catch(() => undefined);
    }
    for (const serverId of createdServerIds.splice(0)) {
      await deleteMcpServer(serverId).catch(() => undefined);
    }
  });

  e2eTest(
    'mock.agent calls a custom Fetch MCP tool and writes Markdown evidence',
    { timeout: 300000 },
    async () => {
      const now = Date.now();
      const server = await createMcpServer({
        name: `e2e-fetch-reference-${now}`,
        description: 'Temporary Fetch MCP server for deterministic agent gateway coverage',
        transportType: 'stdio',
        command: 'docker',
        args: ['run', '-i', '--rm', 'mcp/fetch'],
        enabled: true,
      });
      createdServerIds.push(server.id);

      const connection = await testMcpServerConnection(server.id);
      expect(connection.success).toBe(true);
      expect(connection.toolCount ?? 0).toBeGreaterThan(0);

      const workflowId = await createWorkflow({
        name: `E2E: Mock Agent Fetch MCP ${now}`,
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
                  enabledServers: [server.id],
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
                params: {
                  callTools: true,
                  maxToolCalls: 1,
                },
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
      '- Tool: ' + String(fetchCall.toolName || 'Fetch_Reference__fetch'),
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
                inputOverrides: {
                  artifactName: 'mcp-agent-tool-smoke',
                },
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
      });
      createdWorkflowIds.push(workflowId);

      const runId = await runWorkflow(workflowId, { trigger: 'fetch-mcp-e2e' });
      const status = await pollRunStatus(runId, 300000);
      expect(status.status).toBe('COMPLETED');

      const traceEvents = await getTraceEvents(runId);
      const mockCompleted = traceEvents.find(
        (event) => event.nodeId === 'mock-agent' && event.type === 'COMPLETED',
      );
      expect(mockCompleted).toBeDefined();

      const resultResponse = await fetch(`${API_BASE}/workflows/runs/${runId}/result`, {
        headers: HEADERS,
      });
      expect(resultResponse.ok).toBe(true);
      const result = await resultResponse.json();
      const mockOutput = result?.result?.outputs?.['mock-agent'];
      const toolCalls = Array.isArray(mockOutput?.toolCallResults)
        ? mockOutput.toolCallResults
        : [];
      expect(toolCalls.length).toBeGreaterThanOrEqual(1);
      expect(String(toolCalls[0].toolName)).toEndWith('__fetch');
      expect(toolCalls[0].success).toBe(true);
      expect(String(toolCalls[0].output)).toContain('Example Domain');

      const reportMarkdown = result?.result?.outputs?.['build-report']?.reportMarkdown;
      expect(reportMarkdown).toContain('## External MCP Evidence Used');
      expect(reportMarkdown).toContain('https://example.com');
      expect(reportMarkdown).toContain('Example Domain');
    },
  );
});
