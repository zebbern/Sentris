/**
 * E2E Tests — Secrets Manager
 *
 * Validates the full Secrets lifecycle via the REST API:
 * create, list, get-by-id, get-value, update metadata, rotate, delete.
 */

import { expect, beforeAll } from 'bun:test';

import {
  API_BASE,
  HEADERS,
  e2eDescribe,
  e2eTest,
  checkServicesAvailable,
  createSecret,
  getSecret,
  getSecretValue,
  listSecrets,
  updateSecret,
  rotateSecret,
  deleteSecret,
  fetchSecretRaw,
} from '../helpers/e2e-harness';

beforeAll(async () => {
  const available = await checkServicesAvailable();
  if (!available) console.log('    Backend API is not available. Skipping.');
});

e2eDescribe('Secrets Manager E2E Tests', () => {
  const suffix = Date.now();

  // Track IDs for cleanup
  const createdIds: string[] = [];

  async function cleanupSecrets(): Promise<void> {
    for (const id of createdIds) {
      try {
        await deleteSecret(id);
      } catch {
        // best-effort cleanup
      }
    }
    createdIds.length = 0;
  }

  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------

  e2eTest('Create a secret returns ID and matching name', { timeout: 15000 }, async () => {
    const name = `e2e-create-${suffix}`;
    const secret = await createSecret(name, 'test-value-create-12345', {
      description: 'E2E test secret',
    });
    createdIds.push(secret.id);

    expect(secret.id).toBeDefined();
    expect(typeof secret.id).toBe('string');
    expect(secret.name).toBe(name);
    expect(secret.description).toBe('E2E test secret');
    expect(secret.createdAt).toBeDefined();
    expect(secret.updatedAt).toBeDefined();

    // Value must NOT be returned in the create response
    expect(secret.value).toBeUndefined();
    console.log(`    Created secret: ${secret.id}`);
  });

  // ---------------------------------------------------------------------------
  // List
  // ---------------------------------------------------------------------------

  e2eTest('List secrets contains created secret without value', { timeout: 15000 }, async () => {
    const name = `e2e-list-${suffix}`;
    const secret = await createSecret(name, 'test-value-list-12345');
    createdIds.push(secret.id);

    const secrets = await listSecrets();

    expect(Array.isArray(secrets)).toBe(true);
    const found = secrets.find((s) => s.id === secret.id);
    expect(found).toBeDefined();
    expect(found!.name).toBe(name);

    // Value must never leak in the list response
    expect((found as any).value).toBeUndefined();
    console.log(`    Listed ${secrets.length} secrets — found target`);
  });

  // ---------------------------------------------------------------------------
  // Get by ID
  // ---------------------------------------------------------------------------

  e2eTest('Get secret by ID returns metadata fields', { timeout: 15000 }, async () => {
    const name = `e2e-get-${suffix}`;
    const created = await createSecret(name, 'test-value-get-12345', {
      description: 'get test',
      tags: ['e2e', 'test'],
    });
    createdIds.push(created.id);

    const fetched = await getSecret(created.id);

    expect(fetched.id).toBe(created.id);
    expect(fetched.name).toBe(name);
    expect(fetched.description).toBe('get test');
    expect(fetched.createdAt).toBeDefined();
    expect(fetched.updatedAt).toBeDefined();

    // Value must NOT be in the metadata response
    expect(fetched.value).toBeUndefined();
    console.log(`    Fetched secret: ${fetched.id}`);
  });

  // ---------------------------------------------------------------------------
  // Get value
  // ---------------------------------------------------------------------------

  e2eTest('Get secret value returns decrypted value', { timeout: 15000 }, async () => {
    const name = `e2e-val-${suffix}`;
    const plainValue = 'test-value-retrieve-99999';
    const created = await createSecret(name, plainValue);
    createdIds.push(created.id);

    const result = await getSecretValue(created.id);

    expect(result.secretId).toBe(created.id);
    expect(result.value).toBe(plainValue);
    expect(result.version).toBeDefined();
    console.log(`    Retrieved value for secret ${created.id} (version ${result.version})`);
  });

  // ---------------------------------------------------------------------------
  // Update metadata
  // ---------------------------------------------------------------------------

  e2eTest('Update secret metadata changes name and description', { timeout: 15000 }, async () => {
    const originalName = `e2e-upd-${suffix}`;
    const created = await createSecret(originalName, 'test-value-update-12345');
    createdIds.push(created.id);

    const newName = `e2e-upd-renamed-${suffix}`;
    const updated = await updateSecret(created.id, {
      name: newName,
      description: 'updated description',
    });

    expect(updated.id).toBe(created.id);
    expect(updated.name).toBe(newName);
    expect(updated.description).toBe('updated description');

    // Verify persisted via a fresh GET
    const fetched = await getSecret(created.id);
    expect(fetched.name).toBe(newName);
    expect(fetched.description).toBe('updated description');
    console.log(`    Updated secret: ${created.id}`);
  });

  // ---------------------------------------------------------------------------
  // Rotate
  // ---------------------------------------------------------------------------

  e2eTest('Rotate secret value succeeds and new value is retrievable', { timeout: 15000 }, async () => {
    const name = `e2e-rot-${suffix}`;
    const created = await createSecret(name, 'old-value-12345');
    createdIds.push(created.id);

    const rotated = await rotateSecret(created.id, 'new-rotated-value-67890');
    expect(rotated.id).toBe(created.id);

    const result = await getSecretValue(created.id);
    expect(result.value).toBe('new-rotated-value-67890');
    console.log(`    Rotated secret: ${created.id} (version ${result.version})`);
  });

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  e2eTest('Delete secret returns 204 and GET returns 404', { timeout: 15000 }, async () => {
    const name = `e2e-del-${suffix}`;
    const created = await createSecret(name, 'test-value-delete-12345');
    // Do NOT push to createdIds — we delete it explicitly in this test

    const status = await deleteSecret(created.id);
    expect(status).toBe(204);

    const res = await fetchSecretRaw(created.id);
    expect(res.status).toBe(404);
    console.log(`    Deleted secret: ${created.id}`);
  });

  // ---------------------------------------------------------------------------
  // Duplicate name
  // ---------------------------------------------------------------------------

  e2eTest('Creating a secret with a duplicate name returns an error', { timeout: 15000 }, async () => {
    const name = `e2e-dup-${suffix}`;
    const first = await createSecret(name, 'value-first');
    createdIds.push(first.id);

    // Attempt to create another secret with the same name
    const res = await fetch(`${API_BASE}/secrets`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ name, value: 'value-second' }),
    });

    // Expect either a 409 Conflict or a 400 Bad Request (depending on implementation)
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    console.log(`    Duplicate name rejected: ${res.status}`);
  });

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  e2eTest('Cleanup test secrets', { timeout: 30000 }, async () => {
    await cleanupSecrets();
    console.log('    Cleanup complete');
  });
});
