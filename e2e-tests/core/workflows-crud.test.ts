/**
 * E2E Tests — Workflows CRUD
 *
 * Validates the full Workflow lifecycle via the REST API:
 * create, list, get-by-id, rename (update metadata), duplicate (via re-create),
 * delete, and trigger-run.
 */

import { expect, beforeAll } from 'bun:test';

import {
  API_BASE,
  HEADERS,
  e2eDescribe,
  e2eTest,
  checkServicesAvailable,
  createWorkflowFull,
  listWorkflows,
  getWorkflow,
  getWorkflowRaw,
  renameWorkflow,
  deleteWorkflowById,
  runWorkflow,
  pollRunStatus,
} from '../helpers/e2e-harness';

beforeAll(async () => {
  const available = await checkServicesAvailable();
  if (!available) console.log('    Backend API is not available. Skipping.');
});

// ---------------------------------------------------------------------------
// Test data factory
// ---------------------------------------------------------------------------

/** Build a minimal valid workflow payload with an entry-point node. */
function buildMinimalWorkflow(name: string) {
  return {
    name,
    description: `E2E test workflow: ${name}`,
    nodes: [
      {
        id: 'start',
        type: 'core.workflow.entrypoint',
        data: {
          label: 'Start',
          config: {
            params: {
              runtimeInputs: [],
            },
          },
        },
        position: { x: 0, y: 0 },
      },
      {
        id: 'script1',
        type: 'core.logic.script',
        data: {
          label: 'Script',
          config: {
            params: {
              variables: [],
              returns: [{ name: 'result', type: 'string' }],
              code: 'export async function script() { return { result: "ok" }; }',
            },
          },
        },
        position: { x: 250, y: 0 },
      },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'script1' }],
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

e2eDescribe('Workflows CRUD E2E Tests', () => {
  const suffix = Date.now();

  // Track IDs for cleanup
  const createdIds: string[] = [];

  async function cleanupWorkflows(): Promise<void> {
    for (const id of createdIds) {
      try {
        await deleteWorkflowById(id);
      } catch {
        // best-effort cleanup
      }
    }
    createdIds.length = 0;
  }

  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------

  e2eTest('Create a workflow — returns ID and matching name', { timeout: 15000 }, async () => {
    const name = `e2e-create-${suffix}`;
    const workflow = await createWorkflowFull(buildMinimalWorkflow(name));
    createdIds.push(workflow.id);

    expect(workflow.id).toBeDefined();
    expect(typeof workflow.id).toBe('string');
    expect(workflow.name).toBe(name);
    expect(workflow.description).toBe(`E2E test workflow: ${name}`);
    expect(workflow.createdAt).toBeDefined();
    expect(workflow.updatedAt).toBeDefined();
    expect(workflow.graph).toBeDefined();
    expect(workflow.graph.nodes).toBeArrayOfSize(2);
    expect(workflow.graph.edges).toBeArrayOfSize(1);

    console.log(`    Created workflow: ${workflow.id}`);
  });

  // ---------------------------------------------------------------------------
  // List
  // ---------------------------------------------------------------------------

  e2eTest('List workflows — created workflow appears in list', { timeout: 15000 }, async () => {
    const name = `e2e-list-${suffix}`;
    const created = await createWorkflowFull(buildMinimalWorkflow(name));
    createdIds.push(created.id);

    const workflows = await listWorkflows();

    expect(Array.isArray(workflows)).toBe(true);
    const found = workflows.find((w: any) => w.id === created.id);
    expect(found).toBeDefined();
    expect(found!.name).toBe(name);

    console.log(`    Listed ${workflows.length} workflows — found target`);
  });

  // ---------------------------------------------------------------------------
  // Get by ID
  // ---------------------------------------------------------------------------

  e2eTest('Get workflow by ID — returns full workflow data', { timeout: 15000 }, async () => {
    const name = `e2e-get-${suffix}`;
    const created = await createWorkflowFull(buildMinimalWorkflow(name));
    createdIds.push(created.id);

    const fetched = await getWorkflow(created.id);

    expect(fetched.id).toBe(created.id);
    expect(fetched.name).toBe(name);
    expect(fetched.description).toBe(`E2E test workflow: ${name}`);
    expect(fetched.graph).toBeDefined();
    expect(fetched.graph.nodes).toBeDefined();
    expect(fetched.graph.edges).toBeDefined();
    expect(fetched.createdAt).toBeDefined();
    expect(fetched.updatedAt).toBeDefined();
    expect(fetched.runCount).toBeDefined();

    console.log(`    Fetched workflow: ${fetched.id}`);
  });

  // ---------------------------------------------------------------------------
  // Rename (PATCH metadata)
  // ---------------------------------------------------------------------------

  e2eTest('Rename workflow — name is updated, other fields preserved', { timeout: 15000 }, async () => {
    const originalName = `e2e-rename-orig-${suffix}`;
    const created = await createWorkflowFull(buildMinimalWorkflow(originalName));
    createdIds.push(created.id);

    const newName = `e2e-rename-updated-${suffix}`;
    const updated = await renameWorkflow(created.id, newName, 'Updated description');

    expect(updated.id).toBe(created.id);
    expect(updated.name).toBe(newName);
    expect(updated.description).toBe('Updated description');

    // Verify persisted via a fresh GET
    const fetched = await getWorkflow(created.id);
    expect(fetched.name).toBe(newName);
    expect(fetched.description).toBe('Updated description');
    // Graph should be preserved
    expect(fetched.graph.nodes).toBeArrayOfSize(2);

    console.log(`    Renamed workflow: ${created.id} → "${newName}"`);
  });

  // ---------------------------------------------------------------------------
  // Duplicate (via GET + re-create)
  // ---------------------------------------------------------------------------

  e2eTest('Duplicate workflow — new workflow created with same structure', { timeout: 15000 }, async () => {
    const originalName = `e2e-dup-original-${suffix}`;
    const original = await createWorkflowFull(buildMinimalWorkflow(originalName));
    createdIds.push(original.id);

    // Fetch the full workflow to get graph data
    const source = await getWorkflow(original.id);

    // Create a copy with a new name
    const copyName = `${originalName} (Copy)`;
    const copy = await createWorkflowFull({
      name: copyName,
      description: source.description,
      nodes: source.graph.nodes,
      edges: source.graph.edges,
    });
    createdIds.push(copy.id);

    // Different ID
    expect(copy.id).not.toBe(original.id);
    // Same structure
    expect(copy.name).toBe(copyName);
    expect(copy.graph.nodes).toBeArrayOfSize(source.graph.nodes.length);
    expect(copy.graph.edges).toBeArrayOfSize(source.graph.edges.length);

    console.log(`    Duplicated workflow: ${original.id} → ${copy.id}`);
  });

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  e2eTest('Delete workflow — returns 200 and GET returns 404', { timeout: 15000 }, async () => {
    const name = `e2e-del-${suffix}`;
    const created = await createWorkflowFull(buildMinimalWorkflow(name));
    // Do NOT push to createdIds — we delete it explicitly

    const status = await deleteWorkflowById(created.id);
    expect(status).toBe(200);

    const res = await getWorkflowRaw(created.id);
    expect(res.status).toBe(404);

    console.log(`    Deleted workflow: ${created.id}`);
  });

  // ---------------------------------------------------------------------------
  // Run workflow
  // ---------------------------------------------------------------------------

  e2eTest('Run workflow — triggers execution and completes', { timeout: 120000 }, async () => {
    const name = `e2e-run-${suffix}`;
    const created = await createWorkflowFull(buildMinimalWorkflow(name));
    createdIds.push(created.id);

    const runId = await runWorkflow(created.id);
    expect(runId).toBeDefined();
    expect(typeof runId).toBe('string');
    console.log(`    Started run: ${runId}`);

    // Poll for completion with generous timeout
    const result = await pollRunStatus(runId, 90000);
    expect(result.status).toBe('COMPLETED');

    console.log(`    Workflow run COMPLETED: ${runId}`);
  });

  // ---------------------------------------------------------------------------
  // Invalid data
  // ---------------------------------------------------------------------------

  e2eTest('Create workflow with empty nodes — rejects with error', { timeout: 15000 }, async () => {
    const res = await fetch(`${API_BASE}/workflows`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        name: `e2e-invalid-${suffix}`,
        nodes: [],
        edges: [],
      }),
    });

    // Backend rejects workflows with no nodes (empty array violates min(1))
    expect(res.ok).toBe(false);
    expect(res.status).toBeGreaterThanOrEqual(400);

    console.log(`    Invalid workflow rejected: ${res.status}`);
  });

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  e2eTest('Cleanup test workflows', { timeout: 30000 }, async () => {
    await cleanupWorkflows();
    console.log('    Cleanup complete');
  });
});
