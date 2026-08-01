import { SQL } from 'bun';
import { afterAll, expect } from 'bun:test';

import {
  API_BASE,
  HEADERS,
  createWorkflow,
  deleteWorkflowById,
  e2eDescribe,
  e2eTest,
  pollRunStatus,
  runWorkflow,
} from '../helpers/e2e-harness';
import {
  formatDatabaseTarget,
  getScriptDatabaseTarget,
} from '../../scripts/lib/local-script-runtime';

const TERMINAL_INVOCATION_STATUSES = new Set(['completed', 'failed', 'ambiguous', 'cancelled']);

e2eDescribe('Durable component tool invocation E2E', () => {
  const createdWorkflowIds: string[] = [];

  afterAll(async () => {
    for (const workflowId of createdWorkflowIds.splice(0)) {
      await deleteWorkflowById(workflowId).catch(() => undefined);
    }
  });

  e2eTest(
    'mock.agent invokes OSV through one durable snapshot-bound attempt',
    { timeout: 300000 },
    async () => {
      const now = Date.now();
      const workflowId = await createWorkflow({
        name: `E2E: Durable OSV component invocation ${now}`,
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
            id: 'osv',
            type: 'sentris.osv.query',
            position: { x: 280, y: -80 },
            data: {
              label: 'OSV Dependency Advisory Query',
              config: {
                mode: 'tool',
                params: {
                  ecosystem: 'npm',
                  severityFloor: 'unknown',
                  hydrateAdvisories: true,
                  maxAdvisoriesPerPackage: 50,
                  includeUnknownSeverity: true,
                },
                inputOverrides: { packageSpecs: [] },
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
        ],
        edges: [
          { id: 'start-agent', source: 'start', target: 'mock-agent' },
          {
            id: 'osv-agent-tools',
            source: 'osv',
            target: 'mock-agent',
            sourceHandle: 'tools',
            targetHandle: 'tools',
          },
        ],
      });
      createdWorkflowIds.push(workflowId);

      const runId = await runWorkflow(workflowId, { trigger: 'durable-osv-e2e' });
      const status = await pollRunStatus(runId, 300000);
      expect(status.status).toBe('COMPLETED');

      const resultResponse = await fetch(`${API_BASE}/workflows/runs/${runId}/result`, {
        headers: HEADERS,
      });
      expect(resultResponse.ok).toBe(true);
      const result = await resultResponse.json();
      const mockOutput = result?.result?.outputs?.['mock-agent'];
      expect(mockOutput?.discoveredTools).toEqual([
        expect.objectContaining({ name: 'osv_dependency_query' }),
      ]);
      expect(mockOutput?.toolCallResults).toHaveLength(1);
      const toolCall = mockOutput.toolCallResults[0];
      expect(toolCall).toMatchObject({
        toolName: 'osv_dependency_query',
        success: true,
      });
      expect(String(toolCall.output)).toMatch(/(?:GHSA|CVE|OSV)-[A-Za-z0-9-]+/);

      const databaseTarget = getScriptDatabaseTarget();
      console.log(formatDatabaseTarget(databaseTarget));
      const sql = new SQL(databaseTarget.connectionString);
      try {
        const authority = await sql<
          {
            grant_count: number;
            snapshot_count: number;
            invocation_count: number;
          }[]
        >`SELECT
             (SELECT count(*)::int
                FROM mcp_capability_grants
               WHERE subject_kind = 'run' AND subject_id = ${runId}) AS grant_count,
             (SELECT count(*)::int
                FROM mcp_capability_snapshots snapshot
                JOIN mcp_capability_grants capability_grant
                  ON capability_grant.id = snapshot.capability_grant_id
               WHERE capability_grant.subject_kind = 'run'
                 AND capability_grant.subject_id = ${runId}) AS snapshot_count,
             (SELECT count(*)::int
                FROM mcp_invocations
               WHERE run_id = ${runId}) AS invocation_count`;
        expect(authority[0]).toEqual({
          grant_count: 1,
          snapshot_count: 1,
          invocation_count: 1,
        });

        const attempts = await sql<
          {
            attempt_number: number;
            attempt_status: string;
            invocation_status: string;
            tool_name: string;
          }[]
        >`SELECT attempt.attempt_number,
                  attempt.status AS attempt_status,
                  invocation.status AS invocation_status,
                  invocation.tool_name
             FROM mcp_invocation_attempts attempt
             JOIN mcp_invocations invocation
               ON invocation.invocation_id = attempt.invocation_id
            WHERE invocation.run_id = ${runId}`;
        expect(attempts).toHaveLength(1);
        expect(attempts[0]).toMatchObject({
          attempt_number: 1,
          invocation_status: 'completed',
          tool_name: 'osv_dependency_query',
        });
        expect(TERMINAL_INVOCATION_STATUSES.has(attempts[0].attempt_status)).toBe(true);
      } finally {
        await sql.close();
      }
    },
  );
});
