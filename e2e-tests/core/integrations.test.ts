/**
 * E2E Tests — Integrations (Providers & Connections)
 *
 * Validates the integration providers listing, provider OAuth configuration
 * CRUD, and connection management endpoints.
 *
 * NOTE: OAuth flows require browser interaction and cannot be fully tested
 * in E2E. These tests cover the non-OAuth API surface.
 */

import { expect, beforeAll, afterAll } from 'bun:test';

import {
  API_BASE,
  HEADERS,
  e2eDescribe,
  e2eTest,
  checkServicesAvailable,
  listIntegrationProviders,
  getProviderConfig,
  upsertProviderConfig,
  deleteProviderConfig,
  listConnections,
  listConnectionsRaw,
} from '../helpers/e2e-harness';

beforeAll(async () => {
  const available = await checkServicesAvailable();
  if (!available) console.log('    Backend API is not available. Skipping.');
});

e2eDescribe('Integrations E2E Tests', () => {
  /** Track providers whose config was upserted, for cleanup. */
  const configuredProviders: string[] = [];

  async function cleanupProviderConfigs(): Promise<void> {
    for (const provider of configuredProviders) {
      try {
        await deleteProviderConfig(provider);
      } catch {
        // best-effort cleanup
      }
    }
    configuredProviders.length = 0;
  }

  // ---------------------------------------------------------------------------
  // List providers
  // ---------------------------------------------------------------------------

  e2eTest('List integration providers — returns available providers', { timeout: 15000 }, async () => {
    console.log('\n  Test: List integration providers');

    const providers = await listIntegrationProviders();

    expect(Array.isArray(providers)).toBe(true);
    expect(providers.length).toBeGreaterThan(0);

    // Each provider must have core fields
    for (const p of providers) {
      expect(typeof p.id).toBe('string');
      expect(typeof p.name).toBe('string');
      expect(typeof p.description).toBe('string');
      expect(Array.isArray(p.defaultScopes)).toBe(true);
      expect(typeof p.supportsRefresh).toBe('boolean');
      expect(typeof p.isConfigured).toBe('boolean');
    }

    // We expect at least github and zoom from the hardcoded provider list
    const ids = providers.map((p: any) => p.id);
    expect(ids).toContain('github');
    expect(ids).toContain('zoom');

    console.log(`    Found ${providers.length} provider(s): ${ids.join(', ')}`);
  });

  // ---------------------------------------------------------------------------
  // Provider configuration — get default
  // ---------------------------------------------------------------------------

  e2eTest('Get provider config — returns default configuration', { timeout: 15000 }, async () => {
    console.log('\n  Test: Get provider config (github)');

    const config = await getProviderConfig('github');

    expect(config.provider).toBe('github');
    expect(typeof config.hasClientSecret).toBe('boolean');
    expect(['environment', 'user']).toContain(config.configuredBy);

    console.log(`    Provider config: configuredBy=${config.configuredBy}, hasSecret=${config.hasClientSecret}`);
  });

  // ---------------------------------------------------------------------------
  // Provider configuration — upsert
  // ---------------------------------------------------------------------------

  e2eTest('Upsert provider config — saves client credentials', { timeout: 15000 }, async () => {
    console.log('\n  Test: Upsert provider config (github)');

    const result = await upsertProviderConfig('github', {
      clientId: 'e2e-test-client-id',
      clientSecret: 'e2e-test-client-secret',
    });

    configuredProviders.push('github');

    expect(result.provider).toBe('github');
    expect(result.clientId).toBe('e2e-test-client-id');
    expect(result.hasClientSecret).toBe(true);
    expect(result.configuredBy).toBe('user');
    expect(result.updatedAt).toBeDefined();

    console.log(`    Upserted config: clientId=${result.clientId}, configuredBy=${result.configuredBy}`);
  });

  // ---------------------------------------------------------------------------
  // Provider configuration — verify after upsert
  // ---------------------------------------------------------------------------

  e2eTest('Get provider config after upsert — reflects saved values', { timeout: 15000 }, async () => {
    console.log('\n  Test: Verify provider config after upsert');

    const config = await getProviderConfig('github');

    expect(config.provider).toBe('github');
    expect(config.clientId).toBe('e2e-test-client-id');
    expect(config.hasClientSecret).toBe(true);
    expect(config.configuredBy).toBe('user');

    console.log(`    Config verified: clientId=${config.clientId}`);
  });

  // ---------------------------------------------------------------------------
  // Provider configuration — delete
  // ---------------------------------------------------------------------------

  e2eTest('Delete provider config — returns 204 No Content', { timeout: 15000 }, async () => {
    console.log('\n  Test: Delete provider config');

    const status = await deleteProviderConfig('github');

    // Should be 204 No Content
    expect(status).toBe(204);

    // Remove from cleanup list since it's deleted
    const idx = configuredProviders.indexOf('github');
    if (idx !== -1) configuredProviders.splice(idx, 1);

    // The user-upserted clientId should no longer be present
    const config = await getProviderConfig('github');
    expect(config.provider).toBe('github');
    expect(config.clientId).not.toBe('e2e-test-client-id');

    console.log(`    Config deleted, clientId is now: ${config.clientId ?? '(env default or null)'}`);
  });

  // ---------------------------------------------------------------------------
  // Connections — list requires userId
  // ---------------------------------------------------------------------------

  e2eTest('List connections without userId — returns 400', { timeout: 15000 }, async () => {
    console.log('\n  Test: List connections without userId');

    const res = await listConnectionsRaw('');

    expect(res.status).toBe(400);

    console.log(`    Missing userId correctly rejected: status=${res.status}`);
  });

  // ---------------------------------------------------------------------------
  // Connections — list with userId (expect empty for test user)
  // ---------------------------------------------------------------------------

  e2eTest('List connections with userId — returns array', { timeout: 15000 }, async () => {
    console.log('\n  Test: List connections with userId');

    const connections = await listConnections('e2e-test-user');

    expect(Array.isArray(connections)).toBe(true);
    // E2E test user likely has no connections, but the endpoint should still return []
    console.log(`    Returned ${connections.length} connection(s) for e2e-test-user`);
  });

  // ---------------------------------------------------------------------------
  // Providers — check isConfigured flag reflects state
  // ---------------------------------------------------------------------------

  e2eTest('Provider isConfigured flag updates after config changes', { timeout: 20000 }, async () => {
    console.log('\n  Test: isConfigured flag lifecycle');

    // Check initial state
    const before = await listIntegrationProviders();
    const zoomBefore = before.find((p: any) => p.id === 'zoom');
    expect(zoomBefore).toBeDefined();
    const wasConfigured = zoomBefore.isConfigured;

    // Upsert zoom config with both clientId and clientSecret
    await upsertProviderConfig('zoom', {
      clientId: 'e2e-zoom-client-id',
      clientSecret: 'e2e-zoom-client-secret',
    });
    configuredProviders.push('zoom');

    // Verify isConfigured is now true
    const after = await listIntegrationProviders();
    const zoomAfter = after.find((p: any) => p.id === 'zoom');
    expect(zoomAfter.isConfigured).toBe(true);

    // Clean up
    await deleteProviderConfig('zoom');
    const idx = configuredProviders.indexOf('zoom');
    if (idx !== -1) configuredProviders.splice(idx, 1);

    // Verify it goes back
    const final = await listIntegrationProviders();
    const zoomFinal = final.find((p: any) => p.id === 'zoom');
    expect(zoomFinal.isConfigured).toBe(wasConfigured);

    console.log(`    isConfigured: before=${wasConfigured} → after=true → reverted=${zoomFinal.isConfigured}`);
  });

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  afterAll(async () => {
    await cleanupProviderConfigs();
  });
});
