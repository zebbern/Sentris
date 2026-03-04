/**
 * E2E Tests - Triage Analytics & SLA Policies
 *
 * Validates analytics query endpoints and SLA policy CRUD.
 *
 * Requirements:
 * - Backend API running
 * - RUN_E2E=true
 */

import { expect, beforeAll } from 'bun:test';
import {
  API_BASE,
  HEADERS,
  runE2E,
  e2eDescribe,
  e2eTest,
  checkServicesAvailable,
} from '../helpers/e2e-harness';

let servicesAvailable = false;

beforeAll(async () => {
  if (!runE2E) {
    console.log('\n  Triage Analytics E2E: Skipping (RUN_E2E not set)');
    return;
  }

  console.log('\n  Triage Analytics E2E: Verifying services...');
  servicesAvailable = await checkServicesAvailable();
  if (!servicesAvailable) {
    console.log('    Required services are not available. Tests will be skipped.');
    return;
  }
  console.log('    Backend API is running');
});

// ---------------------------------------------------------------------------
// Analytics Endpoints
// ---------------------------------------------------------------------------

e2eDescribe('Triage Analytics API E2E Tests', () => {
  e2eTest(
    'GET /findings/analytics/posture-trend?period=30d returns 200 with correct shape',
    async () => {
      const res = await fetch(`${API_BASE}/findings/analytics/posture-trend?period=30d`, {
        headers: HEADERS,
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('buckets');
      expect(Array.isArray(body.buckets)).toBe(true);

      // Verify bucket structure if data exists
      if (body.buckets.length > 0) {
        const bucket = body.buckets[0];
        expect(bucket).toHaveProperty('date');
        expect(typeof bucket.critical).toBe('number');
        expect(typeof bucket.high).toBe('number');
        expect(typeof bucket.medium).toBe('number');
        expect(typeof bucket.low).toBe('number');
        expect(typeof bucket.info).toBe('number');
      }
    },
  );

  e2eTest(
    'GET /findings/analytics/triage-velocity?period=7d returns 200',
    async () => {
      const res = await fetch(`${API_BASE}/findings/analytics/triage-velocity?period=7d`, {
        headers: HEADERS,
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('buckets');
      expect(Array.isArray(body.buckets)).toBe(true);
    },
  );

  e2eTest('GET /findings/analytics/mttr?period=30d returns 200', async () => {
    const res = await fetch(`${API_BASE}/findings/analytics/mttr?period=30d`, {
      headers: HEADERS,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('severities');
    expect(Array.isArray(body.severities)).toBe(true);
    expect(body.severities.length).toBe(5); // one per severity level
  });

  e2eTest(
    'GET /findings/analytics/sla-compliance?period=30d returns 200',
    async () => {
      const res = await fetch(`${API_BASE}/findings/analytics/sla-compliance?period=30d`, {
        headers: HEADERS,
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('severities');
      expect(Array.isArray(body.severities)).toBe(true);
    },
  );

  e2eTest(
    'GET /findings/analytics/status-distribution returns 200',
    async () => {
      const res = await fetch(`${API_BASE}/findings/analytics/status-distribution`, {
        headers: HEADERS,
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('statuses');
      expect(body).toHaveProperty('total');
      expect(Array.isArray(body.statuses)).toBe(true);
      expect(typeof body.total).toBe('number');
    },
  );

  e2eTest(
    'GET /findings/analytics/top-assignees?limit=5 returns 200',
    async () => {
      const res = await fetch(`${API_BASE}/findings/analytics/top-assignees?limit=5`, {
        headers: HEADERS,
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('assignees');
      expect(Array.isArray(body.assignees)).toBe(true);
      expect(body.assignees.length).toBeLessThanOrEqual(5);
    },
  );

  e2eTest('analytics endpoints return empty data for fresh org (not errors)', async () => {
    // All analytics endpoints should return structured empty data, never 500
    const endpoints = [
      '/findings/analytics/posture-trend?period=7d',
      '/findings/analytics/triage-velocity?period=7d',
      '/findings/analytics/mttr?period=7d',
      '/findings/analytics/sla-compliance?period=7d',
      '/findings/analytics/status-distribution',
      '/findings/analytics/top-assignees?limit=10',
    ];

    for (const endpoint of endpoints) {
      const res = await fetch(`${API_BASE}${endpoint}`, { headers: HEADERS });
      expect(res.status).toBe(200);
      const body = await res.json();
      // Response should be a valid object, not an error
      expect(typeof body).toBe('object');
      expect(body).not.toHaveProperty('statusCode');
    }
  });

  e2eTest('analytics endpoints return 401 without auth', async () => {
    const noAuthHeaders = { 'Content-Type': 'application/json' };

    const endpoints = [
      '/findings/analytics/posture-trend?period=30d',
      '/findings/analytics/triage-velocity?period=7d',
      '/findings/analytics/mttr?period=30d',
      '/findings/analytics/sla-compliance?period=30d',
      '/findings/analytics/status-distribution',
      '/findings/analytics/top-assignees?limit=5',
    ];

    for (const endpoint of endpoints) {
      const res = await fetch(`${API_BASE}${endpoint}`, { headers: noAuthHeaders });
      expect(res.status).toBe(401);
    }
  });
});

// ---------------------------------------------------------------------------
// SLA Policy Endpoints
// ---------------------------------------------------------------------------

e2eDescribe('SLA Policy API E2E Tests', () => {
  e2eTest('GET /findings/sla-policies returns 200', async () => {
    const res = await fetch(`${API_BASE}/findings/sla-policies`, {
      headers: HEADERS,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('policies');
    expect(Array.isArray(body.policies)).toBe(true);
  });

  e2eTest(
    'PUT /findings/sla-policies creates/updates policies and returns 200',
    async () => {
      const policies = {
        policies: [
          { severity: 'critical', deadlineHours: 24 },
          { severity: 'high', deadlineHours: 72 },
        ],
      };

      const res = await fetch(`${API_BASE}/findings/sla-policies`, {
        method: 'PUT',
        headers: HEADERS,
        body: JSON.stringify(policies),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('policies');
      expect(body.policies.length).toBe(2);
      expect(body.policies[0]).toHaveProperty('id');
      expect(body.policies[0]).toHaveProperty('severity');
      expect(body.policies[0]).toHaveProperty('deadlineHours');
      expect(body.policies[0]).toHaveProperty('createdAt');
      expect(body.policies[0]).toHaveProperty('updatedAt');
    },
  );

  e2eTest(
    'PUT /findings/sla-policies with invalid body returns 400',
    async () => {
      const invalidBody = {
        policies: [
          { severity: 'invalid_severity', deadlineHours: 24 },
        ],
      };

      const res = await fetch(`${API_BASE}/findings/sla-policies`, {
        method: 'PUT',
        headers: HEADERS,
        body: JSON.stringify(invalidBody),
      });

      // Should be 400 or 422 for validation error
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    },
  );

  e2eTest('SLA policy endpoints return 401 without auth', async () => {
    const noAuthHeaders = { 'Content-Type': 'application/json' };

    const getRes = await fetch(`${API_BASE}/findings/sla-policies`, {
      headers: noAuthHeaders,
    });
    expect(getRes.status).toBe(401);

    const putRes = await fetch(`${API_BASE}/findings/sla-policies`, {
      method: 'PUT',
      headers: noAuthHeaders,
      body: JSON.stringify({ policies: [] }),
    });
    expect(putRes.status).toBe(401);
  });
});
