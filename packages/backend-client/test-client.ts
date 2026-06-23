#!/usr/bin/env bun
/**
 * Quick test script for the Sentris API Client
 * 
 * Prerequisites: Backend must be running on http://localhost:3211
 * 
 * Usage: bun run test-client.ts
 */

import { createSentrisClient } from './src/index';

function getApiBaseUrl() {
  if (process.env.SENTRIS_API_BASE_URL?.trim()) {
    return process.env.SENTRIS_API_BASE_URL.trim().replace(/\/api\/v1\/?$/, '');
  }

  const instance = Number.parseInt(process.env.SENTRIS_INSTANCE ?? '0', 10);
  const port = 3211 + (Number.isFinite(instance) ? instance : 0) * 100;
  return `http://localhost:${port}`;
}

function buildWorkflowPayload(name: string, description: string) {
  return {
    name,
    description,
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
            inputOverrides: {},
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
            inputOverrides: {},
          },
        },
        position: { x: 250, y: 0 },
      },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'script1' }],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

function formatClientError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

async function main() {
  console.log('🧪 Testing Sentris API Client\n');

  const client = createSentrisClient({
    baseUrl: getApiBaseUrl(),
    headers: {
      'x-internal-token': process.env.SENTRIS_INTERNAL_TOKEN ?? 'local-internal-token',
      'x-organization-id': process.env.SENTRIS_ORG_ID ?? 'local-dev',
    },
  });
  let workflowId: string | undefined;

  try {
    // Test health endpoint
    console.log('1️⃣  Testing health endpoint...');
    const health = await client.health();
    if (health.error) {
      throw new Error(`Health check failed: ${formatClientError(health.error)}`);
    }
    console.log('✅ Health check passed\n');

    // Test list components
    console.log('2️⃣  Testing list components...');
    const components = await client.listComponents();
    if (components.error) {
      throw new Error(`List components failed: ${formatClientError(components.error)}`);
    }
    console.log(`✅ Found ${(components.data as any[]).length} components\n`);

    // Test list workflows
    console.log('3️⃣  Testing list workflows...');
    const workflows = await client.listWorkflows();
    if (workflows.error) {
      throw new Error(`List workflows failed: ${formatClientError(workflows.error)}`);
    }
    console.log(`✅ Found ${(workflows.data as any[]).length} workflows\n`);

    // Test create workflow
    console.log('4️⃣  Testing create workflow...');
    const newWorkflow = await client.createWorkflow(
      buildWorkflowPayload('Test Workflow ' + Date.now(), 'Created by API client test'),
    );
    if (newWorkflow.error) {
      throw new Error(`Create workflow failed: ${formatClientError(newWorkflow.error)}`);
    }
    workflowId = (newWorkflow.data as any).id;
    if (!workflowId) {
      throw new Error(`Create workflow response had no id: ${JSON.stringify(newWorkflow.data)}`);
    }
    console.log(`✅ Created workflow: ${workflowId}\n`);

    // Test get workflow
    console.log('5️⃣  Testing get workflow...');
    const workflow = await client.getWorkflow(workflowId);
    if (workflow.error) {
      throw new Error(`Get workflow failed: ${formatClientError(workflow.error)}`);
    }
    console.log(`✅ Retrieved workflow: ${(workflow.data as any).name}\n`);

    // Test update workflow
    console.log('6️⃣  Testing update workflow...');
    const updatedName = `Updated Workflow ${Date.now()}`;
    const updatedDescription = 'Updated by API client test';
    const updated = await client.updateWorkflow(
      workflowId,
      buildWorkflowPayload(updatedName, updatedDescription),
    );
    if (updated.error) {
      throw new Error(`Update workflow failed: ${formatClientError(updated.error)}`);
    }
    if ((updated.data as any).name !== updatedName) {
      throw new Error(`Update workflow returned unexpected name: ${(updated.data as any).name}`);
    }
    if ((updated.data as any).description !== updatedDescription) {
      throw new Error(
        `Update workflow returned unexpected description: ${(updated.data as any).description}`,
      );
    }
    console.log(`✅ Updated workflow: ${workflowId}\n`);

    // Test delete workflow
    console.log('7️⃣  Testing delete workflow...');
    const deleted = await client.deleteWorkflow(workflowId);
    if (deleted.error) {
      throw new Error(`Delete workflow failed: ${formatClientError(deleted.error)}`);
    }
    workflowId = undefined;
    console.log(`✅ Deleted workflow\n`);

    console.log('🎉 All tests passed!');
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  } finally {
    if (workflowId) {
      await client.deleteWorkflow(workflowId).catch(() => undefined);
    }
  }
}

main();
