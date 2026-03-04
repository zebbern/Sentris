/**
 * E2E Tests — Workflow Execution
 *
 * Validates the core product loop beyond CRUD:
 *   create workflow → add nodes → trigger → monitor → verify completion/results.
 *
 * Covers:
 * - Multi-node script data flow (node A output consumed by node B)
 * - HTTP Request component (inline, no Docker)
 * - Failure handling (script throws → run FAILED)
 * - Runtime inputs (entrypoint parameters forwarded to downstream nodes)
 *
 * These tests require:
 * - Backend API running on http://localhost:3211
 * - Worker running and component registry loaded
 * - Temporal, Postgres, and other infrastructure running
 */

import { expect, beforeAll, afterAll } from 'bun:test';

import {
  API_BASE,
  HEADERS,
  e2eDescribe,
  e2eTest,
  checkServicesAvailable,
  createWorkflowFull,
  runWorkflow,
  pollRunStatus,
  getTraceEvents,
  deleteWorkflowById,
} from '../helpers/e2e-harness';

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  console.log('\n  E2E Test Suite: Workflow Execution');
  const available = await checkServicesAvailable();
  if (!available) {
    console.log('    Backend API is not available. Tests will be skipped.');
  } else {
    console.log('    Backend API is running');
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Find a COMPLETED trace event for a specific nodeId. */
function findCompletedEvent(events: any[], nodeId: string) {
  return events.find((e: any) => e.type === 'COMPLETED' && e.nodeId === nodeId);
}

/** Find a FAILED trace event for a specific nodeId. */
function findFailedEvent(events: any[], nodeId: string) {
  return events.find((e: any) => e.type === 'FAILED' && e.nodeId === nodeId);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

e2eDescribe('Workflow Execution E2E Tests', () => {
  const suffix = Date.now();
  const createdIds: string[] = [];

  afterAll(async () => {
    for (const id of createdIds) {
      try {
        await deleteWorkflowById(id);
      } catch {
        // best-effort cleanup
      }
    }
  });

  // -------------------------------------------------------------------------
  // Test 1: Multi-node script data flow
  // -------------------------------------------------------------------------

  e2eTest(
    'Multi-node script workflow — data flows between nodes',
    { timeout: 120_000 },
    async () => {
      console.log('\n    Test: Multi-node script data flow');

      const workflow = await createWorkflowFull({
        name: `e2e-exec-multinode-${suffix}`,
        description: 'E2E: entrypoint → script-producer → script-consumer',
        nodes: [
          {
            id: 'start',
            type: 'core.workflow.entrypoint',
            position: { x: 0, y: 0 },
            data: {
              label: 'Start',
              config: { params: { runtimeInputs: [] } },
            },
          },
          {
            id: 'producer',
            type: 'core.logic.script',
            position: { x: 250, y: 0 },
            data: {
              label: 'Producer',
              config: {
                params: {
                  variables: [],
                  returns: [
                    { name: 'greeting', type: 'string' },
                    { name: 'count', type: 'number' },
                  ],
                  code: `export async function script(): Promise<Output> {
  return { greeting: "hello-from-producer", count: 42 };
}`,
                },
              },
            },
          },
          {
            id: 'consumer',
            type: 'core.logic.script',
            position: { x: 500, y: 0 },
            data: {
              label: 'Consumer',
              config: {
                params: {
                  variables: [
                    { name: 'greeting', type: 'string' },
                    { name: 'count', type: 'number' },
                  ],
                  returns: [
                    { name: 'message', type: 'string' },
                    { name: 'doubled', type: 'number' },
                  ],
                  code: `export async function script(input: Input): Promise<Output> {
  const g = input.greeting ?? "unknown";
  const c = typeof input.count === "number" ? input.count : 0;
  return { message: \`received: \${g}\`, doubled: c * 2 };
}`,
                },
              },
            },
          },
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'producer' },
          { id: 'e2', source: 'producer', target: 'consumer' },
          { id: 'e3', source: 'producer', target: 'consumer', sourceHandle: 'greeting', targetHandle: 'greeting' },
          { id: 'e4', source: 'producer', target: 'consumer', sourceHandle: 'count', targetHandle: 'count' },
        ],
      });

      createdIds.push(workflow.id);
      console.log(`    Workflow ID: ${workflow.id}`);

      // Trigger
      const runId = await runWorkflow(workflow.id);
      console.log(`    Run ID: ${runId}`);

      // Poll for completion
      const result = await pollRunStatus(runId, 90_000);
      console.log(`    Status: ${result.status}`);
      expect(result.status).toBe('COMPLETED');

      // Verify node-level outputs via trace events
      const events = await getTraceEvents(runId);

      const producerEvent = findCompletedEvent(events, 'producer');
      expect(producerEvent).toBeDefined();
      expect(producerEvent.outputSummary?.greeting).toBe('hello-from-producer');
      expect(producerEvent.outputSummary?.count).toBe(42);
      console.log(`    Producer output: ${JSON.stringify(producerEvent.outputSummary)}`);

      const consumerEvent = findCompletedEvent(events, 'consumer');
      expect(consumerEvent).toBeDefined();
      expect(consumerEvent.outputSummary?.message).toBe('received: hello-from-producer');
      expect(consumerEvent.outputSummary?.doubled).toBe(84);
      console.log(`    Consumer output: ${JSON.stringify(consumerEvent.outputSummary)}`);

      console.log('    SUCCESS: Data flowed correctly between nodes');
    },
  );

  // -------------------------------------------------------------------------
  // Test 2: HTTP Request node (inline, no Docker)
  // -------------------------------------------------------------------------

  e2eTest(
    'HTTP Request node — calls external endpoint and completes',
    { timeout: 120_000 },
    async () => {
      console.log('\n    Test: HTTP Request node execution');

      const workflow = await createWorkflowFull({
        name: `e2e-exec-http-${suffix}`,
        description: 'E2E: entrypoint → HTTP GET to httpbin.org',
        nodes: [
          {
            id: 'start',
            type: 'core.workflow.entrypoint',
            position: { x: 0, y: 0 },
            data: {
              label: 'Start',
              config: { params: { runtimeInputs: [] } },
            },
          },
          {
            id: 'http-call',
            type: 'core.http.request',
            position: { x: 250, y: 0 },
            data: {
              label: 'HTTP GET',
              config: {
                params: {
                  method: 'GET',
                  authType: 'none',
                  contentType: 'application/json',
                  timeout: 30_000,
                  failOnError: false,
                },
                inputOverrides: {
                  url: 'https://httpbin.org/get?test=workflow-execution-e2e',
                },
              },
            },
          },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'http-call' }],
      });

      createdIds.push(workflow.id);
      console.log(`    Workflow ID: ${workflow.id}`);

      // Trigger
      const runId = await runWorkflow(workflow.id);
      console.log(`    Run ID: ${runId}`);

      // Poll for completion
      const result = await pollRunStatus(runId, 90_000);
      console.log(`    Status: ${result.status}`);
      expect(result.status).toBe('COMPLETED');

      // Verify HTTP component completed via trace
      const events = await getTraceEvents(runId);

      const httpCompleted = findCompletedEvent(events, 'http-call');
      expect(httpCompleted).toBeDefined();
      console.log(`    HTTP node output keys: ${Object.keys(httpCompleted.outputSummary ?? {}).join(', ')}`);

      // Verify HTTP trace events were captured
      const httpSent = events.filter((e: any) => e.type === 'HTTP_REQUEST_SENT');
      const httpReceived = events.filter((e: any) => e.type === 'HTTP_RESPONSE_RECEIVED');
      expect(httpSent.length).toBeGreaterThanOrEqual(1);
      expect(httpReceived.length).toBeGreaterThanOrEqual(1);

      // Verify response status from HAR data
      const responseEvent = httpReceived[0];
      const harEntry = responseEvent.data?.har;
      if (harEntry) {
        expect(harEntry.response.status).toBe(200);
        console.log(`    HAR response status: ${harEntry.response.status}`);
      }

      console.log('    SUCCESS: HTTP Request node executed and completed');
    },
  );

  // -------------------------------------------------------------------------
  // Test 3: Workflow failure handling
  // -------------------------------------------------------------------------

  e2eTest(
    'Failing script node — run status is FAILED with error info',
    { timeout: 120_000 },
    async () => {
      console.log('\n    Test: Workflow failure handling');

      const workflow = await createWorkflowFull({
        name: `e2e-exec-failure-${suffix}`,
        description: 'E2E: entrypoint → script that throws',
        nodes: [
          {
            id: 'start',
            type: 'core.workflow.entrypoint',
            position: { x: 0, y: 0 },
            data: {
              label: 'Start',
              config: { params: { runtimeInputs: [] } },
            },
          },
          {
            id: 'bad-script',
            type: 'core.logic.script',
            position: { x: 250, y: 0 },
            data: {
              label: 'Failing Script',
              config: {
                params: {
                  variables: [],
                  returns: [{ name: 'result', type: 'string' }],
                  code: `export async function script(): Promise<Output> {
  throw new Error("intentional-e2e-failure");
}`,
                },
              },
            },
          },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'bad-script' }],
      });

      createdIds.push(workflow.id);
      console.log(`    Workflow ID: ${workflow.id}`);

      // Trigger
      const runId = await runWorkflow(workflow.id);
      console.log(`    Run ID: ${runId}`);

      // Poll for terminal status
      const result = await pollRunStatus(runId, 90_000);
      console.log(`    Status: ${result.status}`);
      expect(result.status).toBe('FAILED');

      // Verify error info exists in trace events
      const events = await getTraceEvents(runId);

      const failedEvent = findFailedEvent(events, 'bad-script');
      expect(failedEvent).toBeDefined();
      console.log(`    Failed event data: ${JSON.stringify(failedEvent.data ?? failedEvent.metadata ?? {})}`);

      console.log('    SUCCESS: Failed workflow produces FAILED status with error trace');
    },
  );

  // -------------------------------------------------------------------------
  // Test 4: Workflow with runtime inputs
  // -------------------------------------------------------------------------

  e2eTest(
    'Runtime inputs — forwarded to downstream script node',
    { timeout: 120_000 },
    async () => {
      console.log('\n    Test: Runtime inputs consumed by script');

      const workflow = await createWorkflowFull({
        name: `e2e-exec-inputs-${suffix}`,
        description: 'E2E: entrypoint with runtimeInputs → script that consumes them',
        nodes: [
          {
            id: 'start',
            type: 'core.workflow.entrypoint',
            position: { x: 0, y: 0 },
            data: {
              label: 'Start',
              config: {
                params: {
                  runtimeInputs: [
                    { id: 'target', label: 'Target', type: 'string', required: true },
                    { id: 'severity', label: 'Severity', type: 'number', required: false },
                  ],
                },
              },
            },
          },
          {
            id: 'process',
            type: 'core.logic.script',
            position: { x: 250, y: 0 },
            data: {
              label: 'Process Input',
              config: {
                params: {
                  variables: [
                    { name: 'target', type: 'string' },
                    { name: 'severity', type: 'number' },
                  ],
                  returns: [
                    { name: 'summary', type: 'string' },
                    { name: 'processed', type: 'boolean' },
                  ],
                  code: `export async function script(input: Input): Promise<Output> {
  const target = input.target ?? "none";
  const severity = typeof input.severity === "number" ? input.severity : 0;
  return {
    summary: \`target=\${target},severity=\${severity}\`,
    processed: true,
  };
}`,
                },
              },
            },
          },
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'process' },
          { id: 'e2', source: 'start', target: 'process', sourceHandle: 'target', targetHandle: 'target' },
          { id: 'e3', source: 'start', target: 'process', sourceHandle: 'severity', targetHandle: 'severity' },
        ],
      });

      createdIds.push(workflow.id);
      console.log(`    Workflow ID: ${workflow.id}`);

      // Trigger with runtime inputs
      const runId = await runWorkflow(workflow.id, {
        target: 'example.com',
        severity: 7,
      });
      console.log(`    Run ID: ${runId}`);

      // Poll for completion
      const result = await pollRunStatus(runId, 90_000);
      console.log(`    Status: ${result.status}`);
      expect(result.status).toBe('COMPLETED');

      // Verify the script received and processed the inputs
      const events = await getTraceEvents(runId);

      const processEvent = findCompletedEvent(events, 'process');
      expect(processEvent).toBeDefined();
      expect(processEvent.outputSummary?.summary).toBe('target=example.com,severity=7');
      expect(processEvent.outputSummary?.processed).toBe(true);
      console.log(`    Process output: ${JSON.stringify(processEvent.outputSummary)}`);

      console.log('    SUCCESS: Runtime inputs forwarded to script and consumed correctly');
    },
  );
});
