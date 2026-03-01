/**
 * E2E Tests — MCP Servers
 *
 * Validates the full lifecycle of MCP server configurations:
 * create, list, get, update, toggle, delete.
 */

import { expect, beforeAll, afterAll } from 'bun:test';

import {
  e2eDescribe,
  e2eTest,
  checkServicesAvailable,
  listMcpServers,
  getMcpServer,
  getMcpServerRaw,
  createMcpServer,
  updateMcpServer,
  toggleMcpServer,
  deleteMcpServer,
} from '../helpers/e2e-harness';

beforeAll(async () => {
  const available = await checkServicesAvailable();
  if (!available) console.log('    Backend API is not available. Skipping.');
});

e2eDescribe('MCP Servers E2E Tests', () => {
  const suffix = Date.now();

  /** Track created server IDs for cleanup. */
  const createdIds: string[] = [];

  async function cleanupServers(): Promise<void> {
    for (const id of createdIds) {
      try {
        await deleteMcpServer(id);
      } catch {
        // best-effort cleanup
      }
    }
    createdIds.length = 0;
  }

  // ---------------------------------------------------------------------------
  // Create (HTTP transport)
  // ---------------------------------------------------------------------------

  e2eTest('Create an HTTP MCP server — returns ID and matching name', { timeout: 15000 }, async () => {
    console.log('\n  Test: Create HTTP MCP server');

    const name = `e2e-http-server-${suffix}`;
    const server = await createMcpServer({
      name,
      description: 'E2E test HTTP MCP server',
      transportType: 'http',
      endpoint: 'http://localhost:9999/mcp',
      enabled: false,
    });

    createdIds.push(server.id);

    expect(server.id).toBeDefined();
    expect(typeof server.id).toBe('string');
    expect(server.name).toBe(name);
    expect(server.description).toBe('E2E test HTTP MCP server');
    expect(server.transportType).toBe('http');
    expect(server.endpoint).toBe('http://localhost:9999/mcp');
    expect(server.enabled).toBe(false);
    expect(server.createdAt).toBeDefined();
    expect(server.updatedAt).toBeDefined();

    console.log(`    Created HTTP server: ${server.id}`);
  });

  // ---------------------------------------------------------------------------
  // Create (stdio transport)
  // ---------------------------------------------------------------------------

  e2eTest('Create a stdio MCP server — returns ID with command/args', { timeout: 15000 }, async () => {
    console.log('\n  Test: Create stdio MCP server');

    const name = `e2e-stdio-server-${suffix}`;
    const server = await createMcpServer({
      name,
      description: 'E2E test stdio MCP server',
      transportType: 'stdio',
      command: 'node',
      args: ['./mcp-server.js', '--port', '3000'],
      enabled: false,
    });

    createdIds.push(server.id);

    expect(server.id).toBeDefined();
    expect(server.name).toBe(name);
    expect(server.transportType).toBe('stdio');
    expect(server.command).toBe('node');
    expect(server.args).toEqual(['./mcp-server.js', '--port', '3000']);
    expect(server.enabled).toBe(false);

    console.log(`    Created stdio server: ${server.id}`);
  });

  // ---------------------------------------------------------------------------
  // List
  // ---------------------------------------------------------------------------

  e2eTest('List MCP servers — created servers appear in the list', { timeout: 15000 }, async () => {
    console.log('\n  Test: List MCP servers');

    const servers = await listMcpServers();

    expect(Array.isArray(servers)).toBe(true);

    // Both servers we created above should be present
    for (const id of createdIds) {
      const match = servers.find((s: any) => s.id === id);
      expect(match).toBeDefined();
    }

    console.log(`    Found ${servers.length} server(s), ${createdIds.length} test server(s) present`);
  });

  // ---------------------------------------------------------------------------
  // Get by ID
  // ---------------------------------------------------------------------------

  e2eTest('Get MCP server by ID — returns full metadata', { timeout: 15000 }, async () => {
    console.log('\n  Test: Get MCP server by ID');

    const id = createdIds[0];
    const server = await getMcpServer(id);

    expect(server.id).toBe(id);
    expect(server.name).toContain('e2e-http-server-');
    expect(server.description).toBe('E2E test HTTP MCP server');
    expect(server.transportType).toBe('http');
    expect(server.endpoint).toBe('http://localhost:9999/mcp');
    expect(server.enabled).toBe(false);
    expect(server.createdAt).toBeDefined();
    expect(server.updatedAt).toBeDefined();
    // hasHeaders should be false since we didn't set headers
    expect(server.hasHeaders).toBe(false);

    console.log(`    Server metadata OK: name=${server.name}, enabled=${server.enabled}`);
  });

  // ---------------------------------------------------------------------------
  // Update (PATCH)
  // ---------------------------------------------------------------------------

  e2eTest('Update MCP server — change name and description', { timeout: 15000 }, async () => {
    console.log('\n  Test: Update MCP server');

    const id = createdIds[0];
    const newName = `e2e-updated-server-${suffix}`;
    const updated = await updateMcpServer(id, {
      name: newName,
      description: 'Updated description',
    });

    expect(updated.id).toBe(id);
    expect(updated.name).toBe(newName);
    expect(updated.description).toBe('Updated description');

    // Verify via GET
    const fetched = await getMcpServer(id);
    expect(fetched.name).toBe(newName);
    expect(fetched.description).toBe('Updated description');

    console.log(`    Server updated: name=${newName}`);
  });

  // ---------------------------------------------------------------------------
  // Toggle enabled/disabled
  // ---------------------------------------------------------------------------

  e2eTest('Toggle MCP server — flips enabled state', { timeout: 15000 }, async () => {
    console.log('\n  Test: Toggle MCP server');

    const id = createdIds[0];

    // Initially disabled (created with enabled: false)
    const before = await getMcpServer(id);
    expect(before.enabled).toBe(false);

    // Toggle → should become enabled
    const toggled = await toggleMcpServer(id);
    expect(toggled.enabled).toBe(true);

    // Toggle back → disabled again
    const toggledBack = await toggleMcpServer(id);
    expect(toggledBack.enabled).toBe(false);

    console.log(`    Toggle: false → true → false`);
  });

  // ---------------------------------------------------------------------------
  // Update endpoint and transport-specific fields
  // ---------------------------------------------------------------------------

  e2eTest('Update MCP server — change endpoint via PATCH', { timeout: 15000 }, async () => {
    console.log('\n  Test: Update MCP server endpoint');

    const id = createdIds[0];
    const updated = await updateMcpServer(id, {
      endpoint: 'http://localhost:8888/mcp-v2',
      healthCheckUrl: 'http://localhost:8888/health',
    });

    expect(updated.endpoint).toBe('http://localhost:8888/mcp-v2');
    expect(updated.healthCheckUrl).toBe('http://localhost:8888/health');

    console.log(`    Endpoint updated to: ${updated.endpoint}`);
  });

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  e2eTest('Delete MCP server — verify removal', { timeout: 15000 }, async () => {
    console.log('\n  Test: Delete MCP server');

    const id = createdIds[0];
    const status = await deleteMcpServer(id);

    // Should be 204 No Content
    expect(status).toBe(204);

    // GET should now return 404
    const getRes = await getMcpServerRaw(id);
    expect(getRes.status).toBe(404);

    // Remove from cleanup list
    const idx = createdIds.indexOf(id);
    if (idx !== -1) createdIds.splice(idx, 1);

    console.log(`    Server deleted and confirmed gone (404)`);
  });

  // ---------------------------------------------------------------------------
  // Delete second server
  // ---------------------------------------------------------------------------

  e2eTest('Delete stdio MCP server — verify removal', { timeout: 15000 }, async () => {
    console.log('\n  Test: Delete stdio MCP server');

    const id = createdIds[0]; // stdio server is now at index 0
    const status = await deleteMcpServer(id);
    expect(status).toBe(204);

    const getRes = await getMcpServerRaw(id);
    expect(getRes.status).toBe(404);

    const idx = createdIds.indexOf(id);
    if (idx !== -1) createdIds.splice(idx, 1);

    console.log(`    Stdio server deleted and confirmed gone (404)`);
  });

  // ---------------------------------------------------------------------------
  // Get non-existent server — 404
  // ---------------------------------------------------------------------------

  e2eTest('Get non-existent MCP server — returns 404', { timeout: 15000 }, async () => {
    console.log('\n  Test: Get non-existent MCP server');

    const fakeId = '00000000-0000-0000-0000-000000000000';
    const res = await getMcpServerRaw(fakeId);

    expect(res.status).toBe(404);

    console.log(`    Non-existent server correctly returned 404`);
  });

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  afterAll(async () => {
    await cleanupServers();
  });
});
