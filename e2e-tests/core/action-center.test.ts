/**
 * E2E Tests — Action Center (Human Inputs)
 *
 * Validates the human-in-the-loop approval workflow:
 * - Creates a workflow with a manual approval node
 * - Triggers a run so the workflow pauses at the approval gate
 * - Lists, filters, and retrieves pending human input requests
 * - Approves and rejects requests via authenticated and public token endpoints
 * - Verifies edge cases (non-existent ID, already-resolved input)
 */

import { expect, beforeAll, afterAll } from 'bun:test';

import {
  API_BASE,
  HEADERS,
  e2eDescribe,
  e2eTest,
  checkServicesAvailable,
  createWorkflow,
  deleteWorkflowById,
  runWorkflow,
  pollRunUntilAwaitingInput,
  pollRunStatus,
  listHumanInputs,
  getHumanInput,
  getHumanInputRaw,
  resolveHumanInput,
  resolveByToken,
} from '../helpers/e2e-harness';

beforeAll(async () => {
  const available = await checkServicesAvailable();
  if (!available) console.log('    Backend API is not available. Skipping.');
});

// ---------------------------------------------------------------------------
// Workflow factory — builds a minimal workflow with a manual approval node
// ---------------------------------------------------------------------------

function buildApprovalWorkflow(name: string) {
  return {
    name,
    description: `E2E action-center test: ${name}`,
    nodes: [
      {
        id: 'start',
        type: 'core.workflow.entrypoint',
        data: {
          label: 'Start',
          config: { params: { runtimeInputs: [] } },
        },
        position: { x: 0, y: 0 },
      },
      {
        id: 'approval',
        type: 'core.manual_action.approval',
        data: {
          label: 'Approval Gate',
          config: {
            params: {
              title: `E2E Approval — ${name}`,
              description: 'Please approve this E2E test request.',
              variables: [],
            },
          },
        },
        position: { x: 300, y: 0 },
      },
      {
        id: 'end',
        type: 'core.logic.script',
        data: {
          label: 'Done',
          config: {
            params: {
              variables: [],
              returns: [{ name: 'result', type: 'string' }],
              code: 'export async function script() { return { result: "done" }; }',
            },
          },
        },
        position: { x: 600, y: 0 },
      },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'approval' },
      { id: 'e2', source: 'approval', target: 'end' },
    ],
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

e2eDescribe('Action Center (Human Inputs) E2E Tests', () => {
  const suffix = Date.now();
  const createdWorkflowIds: string[] = [];

  async function cleanupWorkflows(): Promise<void> {
    for (const id of createdWorkflowIds) {
      try {
        await deleteWorkflowById(id);
      } catch {
        // best-effort cleanup
      }
    }
    createdWorkflowIds.length = 0;
  }

  afterAll(async () => {
    await cleanupWorkflows();
  });

  // -----------------------------------------------------------------------
  // List — baseline (may be empty)
  // -----------------------------------------------------------------------

  e2eTest('List human inputs — returns 200 with an array', { timeout: 15000 }, async () => {
    console.log('\n  Test: List human inputs');

    const inputs = await listHumanInputs();
    expect(Array.isArray(inputs)).toBe(true);

    console.log(`    Found ${inputs.length} human input(s)`);
  });

  // -----------------------------------------------------------------------
  // Get non-existent — expect 404
  // -----------------------------------------------------------------------

  e2eTest('Get non-existent human input — returns 404', { timeout: 15000 }, async () => {
    console.log('\n  Test: Get non-existent human input');

    const fakeId = '00000000-0000-0000-0000-000000000000';
    const res = await getHumanInputRaw(fakeId);
    expect(res.status).toBe(404);

    console.log('    Correctly returned 404');
  });

  // -----------------------------------------------------------------------
  // Full approval flow: create workflow → run → pending → approve → complete
  // -----------------------------------------------------------------------

  e2eTest(
    'Full approval flow — run workflow, list pending, approve, verify completion',
    { timeout: 120000 },
    async () => {
      console.log('\n  Test: Full approval flow');

      // 1. Create workflow with approval node
      const workflowId = await createWorkflow(
        buildApprovalWorkflow(`E2E Approve ${suffix}`),
      );
      createdWorkflowIds.push(workflowId);
      console.log(`    Workflow created: ${workflowId}`);

      // 2. Run the workflow — it should pause at the approval gate
      const runId = await runWorkflow(workflowId);
      console.log(`    Workflow run started: ${runId}`);

      // 3. Poll until AWAITING_INPUT
      const awaitingStatus = await pollRunUntilAwaitingInput(runId, 60000);
      expect(awaitingStatus.status).toBe('AWAITING_INPUT');
      console.log('    Run is AWAITING_INPUT');

      // 4. List pending human inputs — our request should appear
      const pendingInputs = await listHumanInputs({ status: 'pending' });
      expect(Array.isArray(pendingInputs)).toBe(true);

      const ourInput = pendingInputs.find(
        (inp: any) => inp.runId === runId || inp.workflowId === workflowId,
      );
      expect(ourInput).toBeDefined();
      expect(ourInput.status).toBe('pending');
      expect(ourInput.inputType).toBe('approval');
      expect(ourInput.title).toContain('E2E Approve');
      expect(ourInput.id).toBeDefined();
      expect(ourInput.createdAt).toBeDefined();
      console.log(`    Found pending input: ${ourInput.id}`);

      // 5. Get by ID — verify fields
      const detail = await getHumanInput(ourInput.id);
      expect(detail.id).toBe(ourInput.id);
      expect(detail.status).toBe('pending');
      expect(detail.inputType).toBe('approval');
      expect(detail.title).toContain('E2E Approve');
      expect(detail.nodeRef).toBeDefined();
      expect(detail.resolveToken).toBeDefined();
      console.log('    Detail fetched successfully');

      // 6. Filter by inputType=approval — should include our input
      const approvalOnly = await listHumanInputs({ inputType: 'approval' });
      const found = approvalOnly.some((inp: any) => inp.id === ourInput.id);
      expect(found).toBe(true);
      console.log('    inputType filter works correctly');

      // 7. Approve the request
      const resolved = await resolveHumanInput(ourInput.id, {
        responseData: { status: 'approved', comment: 'E2E test approval' },
        respondedBy: 'e2e-tester',
      });
      expect(resolved.status).toBe('resolved');
      expect(resolved.respondedBy).toBe('e2e-tester');
      console.log('    Approval resolved');

      // 8. Verify workflow completes after approval
      const finalStatus = await pollRunStatus(runId, 60000);
      expect(finalStatus.status).toBe('COMPLETED');
      console.log('    Workflow COMPLETED after approval');
    },
  );

  // -----------------------------------------------------------------------
  // Rejection flow: trigger workflow, reject, verify completion
  // -----------------------------------------------------------------------

  e2eTest(
    'Rejection flow — run workflow, reject human input, verify workflow completes',
    { timeout: 120000 },
    async () => {
      console.log('\n  Test: Rejection flow');

      // 1. Create and run workflow
      const workflowId = await createWorkflow(
        buildApprovalWorkflow(`E2E Reject ${suffix}`),
      );
      createdWorkflowIds.push(workflowId);

      const runId = await runWorkflow(workflowId);
      console.log(`    Workflow run started: ${runId}`);

      // 2. Wait for AWAITING_INPUT
      const awaitingStatus = await pollRunUntilAwaitingInput(runId, 60000);
      expect(awaitingStatus.status).toBe('AWAITING_INPUT');

      // 3. Find pending input
      const pendingInputs = await listHumanInputs({ status: 'pending' });
      const ourInput = pendingInputs.find(
        (inp: any) => inp.runId === runId || inp.workflowId === workflowId,
      );
      expect(ourInput).toBeDefined();
      console.log(`    Found pending input: ${ourInput.id}`);

      // 4. Reject it
      const resolved = await resolveHumanInput(ourInput.id, {
        responseData: { status: 'rejected', comment: 'E2E test rejection' },
        respondedBy: 'e2e-tester',
      });
      expect(resolved.status).toBe('resolved');
      console.log('    Rejection resolved');

      // 5. Verify workflow completes (rejection still completes the run)
      const finalStatus = await pollRunStatus(runId, 60000);
      expect(['COMPLETED', 'FAILED'].includes(finalStatus.status)).toBe(true);
      console.log(`    Workflow finished with status: ${finalStatus.status}`);
    },
  );

  // -----------------------------------------------------------------------
  // Resolve already resolved — expect error
  // -----------------------------------------------------------------------

  e2eTest(
    'Resolve already-resolved input — returns error',
    { timeout: 120000 },
    async () => {
      console.log('\n  Test: Resolve already-resolved');

      // 1. Create and run workflow
      const workflowId = await createWorkflow(
        buildApprovalWorkflow(`E2E Double-resolve ${suffix}`),
      );
      createdWorkflowIds.push(workflowId);

      const runId = await runWorkflow(workflowId);
      const awaitingStatus = await pollRunUntilAwaitingInput(runId, 60000);
      expect(awaitingStatus.status).toBe('AWAITING_INPUT');

      // 2. Find and resolve
      const pendingInputs = await listHumanInputs({ status: 'pending' });
      const ourInput = pendingInputs.find(
        (inp: any) => inp.runId === runId || inp.workflowId === workflowId,
      );
      expect(ourInput).toBeDefined();

      await resolveHumanInput(ourInput.id, {
        responseData: { status: 'approved' },
        respondedBy: 'e2e-tester',
      });
      console.log('    First resolve succeeded');

      // Wait for workflow to finish processing the approval
      await pollRunStatus(runId, 60000);

      // 3. Try resolving again — should fail
      const res = await fetch(`${API_BASE}/human-inputs/${ourInput.id}/resolve`, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({
          responseData: { status: 'approved' },
          respondedBy: 'e2e-tester-2',
        }),
      });

      expect(res.status).toBeGreaterThanOrEqual(400);
      console.log(`    Double-resolve correctly rejected with status ${res.status}`);
    },
  );

  // -----------------------------------------------------------------------
  // Public token resolution
  // -----------------------------------------------------------------------

  e2eTest(
    'Resolve via token endpoint — approve using token',
    { timeout: 120000 },
    async () => {
      console.log('\n  Test: Resolve via token endpoint');

      // 1. Create and run workflow
      const workflowId = await createWorkflow(
        buildApprovalWorkflow(`E2E Public Token ${suffix}`),
      );
      createdWorkflowIds.push(workflowId);

      const runId = await runWorkflow(workflowId);
      const awaitingStatus = await pollRunUntilAwaitingInput(runId, 60000);
      expect(awaitingStatus.status).toBe('AWAITING_INPUT');

      // 2. Find pending input and grab its resolveToken
      const pendingInputs = await listHumanInputs({ status: 'pending' });
      const ourInput = pendingInputs.find(
        (inp: any) => inp.runId === runId || inp.workflowId === workflowId,
      );
      expect(ourInput).toBeDefined();

      const detail = await getHumanInput(ourInput.id);
      expect(detail.resolveToken).toBeDefined();
      const token = detail.resolveToken;
      console.log(`    Token: ${token.substring(0, 8)}...`);

      // 3. Resolve via public token
      const result = await resolveByToken(token, { action: 'approve' });
      expect(result.success).toBe(true);
      expect(result.input.status).toBe('resolved');
      console.log('    Token resolution succeeded');

      // 4. Verify workflow completes
      const finalStatus = await pollRunStatus(runId, 60000);
      expect(finalStatus.status).toBe('COMPLETED');
      console.log('    Workflow COMPLETED after token approval');
    },
  );

  // -----------------------------------------------------------------------
  // Public token rejection via POST /resolve/:token
  // -----------------------------------------------------------------------

  e2eTest(
    'Reject via token endpoint',
    { timeout: 120000 },
    async () => {
      console.log('\n  Test: Reject via token endpoint');

      const workflowId = await createWorkflow(
        buildApprovalWorkflow(`E2E Public Reject ${suffix}`),
      );
      createdWorkflowIds.push(workflowId);

      const runId = await runWorkflow(workflowId);
      const awaitingStatus = await pollRunUntilAwaitingInput(runId, 60000);
      expect(awaitingStatus.status).toBe('AWAITING_INPUT');

      const pendingInputs = await listHumanInputs({ status: 'pending' });
      const ourInput = pendingInputs.find(
        (inp: any) => inp.runId === runId || inp.workflowId === workflowId,
      );
      expect(ourInput).toBeDefined();

      const detail = await getHumanInput(ourInput.id);
      const token = detail.resolveToken;

      const result = await resolveByToken(token, { action: 'reject' });
      expect(result.success).toBe(true);
      expect(result.input.status).toBe('resolved');
      console.log('    Token rejection succeeded');

      const finalStatus = await pollRunStatus(runId, 60000);
      expect(['COMPLETED', 'FAILED'].includes(finalStatus.status)).toBe(true);
      console.log(`    Workflow finished with status: ${finalStatus.status}`);
    },
  );

  // -----------------------------------------------------------------------
  // Public token resolution WITHOUT auth headers
  // -----------------------------------------------------------------------

  e2eTest(
    'Resolve via token endpoint without auth headers (@Public)',
    { timeout: 120000 },
    async () => {
      console.log('\n  Test: Resolve via token without auth headers');

      // 1. Create and run workflow
      const workflowId = await createWorkflow(
        buildApprovalWorkflow(`E2E No-Auth Token ${suffix}`),
      );
      createdWorkflowIds.push(workflowId);

      const runId = await runWorkflow(workflowId);
      const awaitingStatus = await pollRunUntilAwaitingInput(runId, 60000);
      expect(awaitingStatus.status).toBe('AWAITING_INPUT');

      // 2. Find pending input and grab its resolveToken
      const pendingInputs = await listHumanInputs({ status: 'pending' });
      const ourInput = pendingInputs.find(
        (inp: any) => inp.runId === runId || inp.workflowId === workflowId,
      );
      expect(ourInput).toBeDefined();

      const detail = await getHumanInput(ourInput.id);
      expect(detail.resolveToken).toBeDefined();
      const token = detail.resolveToken;

      // 3. Resolve via token WITHOUT any auth headers — only Content-Type
      const res = await fetch(`${API_BASE}/human-inputs/resolve/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve' }),
      });
      expect(res.ok).toBe(true);

      const result = await res.json();
      expect(result.success).toBe(true);
      expect(result.input.status).toBe('resolved');
      console.log('    No-auth token resolution succeeded — @Public() works');

      // 4. Verify workflow completes
      const finalStatus = await pollRunStatus(runId, 60000);
      expect(finalStatus.status).toBe('COMPLETED');
      console.log('    Workflow COMPLETED after no-auth token approval');
    },
  );

  // -----------------------------------------------------------------------
  // List resolved inputs — verify status filter for resolved
  // -----------------------------------------------------------------------

  e2eTest(
    'List resolved human inputs — previously resolved items appear',
    { timeout: 15000 },
    async () => {
      console.log('\n  Test: List resolved human inputs');

      const resolvedInputs = await listHumanInputs({ status: 'resolved' });
      expect(Array.isArray(resolvedInputs)).toBe(true);

      // After the above tests, there should be resolved items
      if (resolvedInputs.length > 0) {
        const sample = resolvedInputs[0];
        expect(sample.status).toBe('resolved');
        expect(sample.respondedAt).toBeDefined();
      }

      console.log(`    Found ${resolvedInputs.length} resolved input(s)`);
    },
  );
});
