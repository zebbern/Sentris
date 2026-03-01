/**
 * E2E Tests - API Keys Management
 *
 * Validates the full lifecycle of API keys: create, list, get, update, revoke, auth rejection, and delete.
 */

import { expect, beforeAll, afterAll } from 'bun:test';

import {
  API_BASE,
  HEADERS,
  e2eDescribe,
  e2eTest,
  checkServicesAvailable,
  createApiKey,
  listApiKeys,
  getApiKey,
  updateApiKey,
  revokeApiKey,
  deleteApiKey,
  getApiKeyRaw,
} from '../helpers/e2e-harness';

beforeAll(async () => {
  const available = await checkServicesAvailable();
  if (!available) console.log('    Backend API is not available. Skipping.');
});

/** Small delay to avoid hitting rate limiter between tests. */
const rateLimitDelay = (ms = 1500) => new Promise((r) => setTimeout(r, ms));

/** Default permissions granting read-only access for testing. */
const TEST_PERMISSIONS = {
  workflows: { run: false, list: true, read: true },
  runs: { read: true, cancel: false },
  audit: { read: true },
};

/** Track created key IDs for cleanup. */
const createdKeyIds: string[] = [];

e2eDescribe('API Keys Management E2E Tests', () => {
  let createdKeyId: string;
  let createdPlainKey: string;

  // --------------------------------------------------
  // Create
  // --------------------------------------------------
  e2eTest('Create an API key — returns id, name, and plainKey', { timeout: 30000 }, async () => {
    console.log('\n  Test: Create API key');

    const keyName = `e2e-test-key-${Date.now()}`;
    const result = await createApiKey({
      name: keyName,
      description: 'E2E test key',
      permissions: TEST_PERMISSIONS,
    });

    expect(result.id).toBeDefined();
    expect(result.name).toBe(keyName);
    expect(result.plainKey).toBeDefined();
    expect(result.plainKey).toMatch(/^sk_live_/);
    expect(result.isActive).toBe(true);
    expect(result.keyPrefix).toBe('sk_live_');
    expect(result.keyHint).toBeDefined();
    expect(result.createdAt).toBeDefined();

    createdKeyId = result.id;
    createdPlainKey = result.plainKey;
    createdKeyIds.push(createdKeyId);

    console.log(`    API key created: ${createdKeyId} (hint: ${result.keyHint})`);
  });

  // --------------------------------------------------
  // List
  // --------------------------------------------------
  e2eTest('List API keys — created key appears in list', { timeout: 30000 }, async () => {
    console.log('\n  Test: List API keys');

    const keys = await listApiKeys();

    expect(Array.isArray(keys)).toBe(true);
    const match = keys.find((k: any) => k.id === createdKeyId);
    expect(match).toBeDefined();
    expect(match.name).toBeDefined();
    // plainKey should NOT appear in list responses
    expect(match.plainKey).toBeUndefined();

    console.log(`    Found ${keys.length} API key(s), test key present`);
  });

  // --------------------------------------------------
  // Get by ID
  // --------------------------------------------------
  e2eTest('Get API key by ID — returns metadata fields', { timeout: 30000 }, async () => {
    console.log('\n  Test: Get API key by ID');

    const key = await getApiKey(createdKeyId);

    expect(key.id).toBe(createdKeyId);
    expect(key.name).toBeDefined();
    expect(key.description).toBe('E2E test key');
    expect(key.keyPrefix).toBe('sk_live_');
    expect(key.keyHint).toBeDefined();
    expect(key.isActive).toBe(true);
    expect(key.createdAt).toBeDefined();
    expect(key.updatedAt).toBeDefined();
    expect(typeof key.usageCount).toBe('number');
    // plainKey should NOT be returned on get
    expect(key.plainKey).toBeUndefined();

    console.log(`    Key metadata OK: isActive=${key.isActive}, usageCount=${key.usageCount}`);
  });

  // --------------------------------------------------
  // Update (PATCH)
  // --------------------------------------------------
  e2eTest('Update API key — change name via PATCH', { timeout: 30000 }, async () => {
    console.log('\n  Test: Update API key');

    const newName = `e2e-updated-key-${Date.now()}`;
    const updated = await updateApiKey(createdKeyId, { name: newName });

    expect(updated.id).toBe(createdKeyId);
    expect(updated.name).toBe(newName);
    expect(updated.isActive).toBe(true);

    // Verify via GET
    const fetched = await getApiKey(createdKeyId);
    expect(fetched.name).toBe(newName);

    console.log(`    Key name updated to: ${newName}`);
  });

  // --------------------------------------------------
  // Auth with API key (before revocation)
  // --------------------------------------------------
  e2eTest('Authenticate with API key — access a protected endpoint', { timeout: 30000 }, async () => {
    await rateLimitDelay();
    console.log('\n  Test: Auth with API key');

    const res = await fetch(`${API_BASE}/workflows`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${createdPlainKey}`,
      },
    });

    // The key has workflows.list=true, so listing workflows should succeed
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(Array.isArray(data) || typeof data === 'object').toBe(true);

    console.log(`    Authenticated request succeeded (status: ${res.status})`);
  });

  // --------------------------------------------------
  // Revoke
  // --------------------------------------------------
  e2eTest('Revoke API key — status becomes inactive', { timeout: 30000 }, async () => {
    await rateLimitDelay();
    console.log('\n  Test: Revoke API key');

    const revoked = await revokeApiKey(createdKeyId);

    expect(revoked.id).toBe(createdKeyId);
    expect(revoked.isActive).toBe(false);

    // Verify via GET
    const fetched = await getApiKey(createdKeyId);
    expect(fetched.isActive).toBe(false);

    console.log(`    Key revoked: isActive=${revoked.isActive}`);
  });

  // --------------------------------------------------
  // Use revoked key (expect rejection)
  // --------------------------------------------------
  e2eTest('Use revoked key — request is rejected', { timeout: 30000 }, async () => {
    await rateLimitDelay();
    console.log('\n  Test: Use revoked API key');

    const res = await fetch(`${API_BASE}/workflows`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${createdPlainKey}`,
      },
    });

    // Revoked key should be rejected — 401 or 403
    expect(res.status === 401 || res.status === 403).toBe(true);

    console.log(`    Revoked key rejected with status: ${res.status}`);
  });

  // --------------------------------------------------
  // Delete
  // --------------------------------------------------
  e2eTest('Delete API key — verify removal', { timeout: 30000 }, async () => {
    await rateLimitDelay();
    console.log('\n  Test: Delete API key');

    const result = await deleteApiKey(createdKeyId);
    expect(result.success).toBe(true);

    // GET should now return 404
    const getRes = await getApiKeyRaw(createdKeyId);
    expect(getRes.status).toBe(404);

    // Remove from cleanup list since it's already deleted
    const idx = createdKeyIds.indexOf(createdKeyId);
    if (idx !== -1) createdKeyIds.splice(idx, 1);

    console.log(`    Key deleted and confirmed gone (404)`);
  });

  // --------------------------------------------------
  // Cleanup stale keys
  // --------------------------------------------------
  afterAll(async () => {
    for (const id of createdKeyIds) {
      try {
        await deleteApiKey(id);
      } catch {
        // Ignore cleanup errors
      }
    }
  });
});
