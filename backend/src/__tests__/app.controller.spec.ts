import { describe, expect, it, vi } from 'bun:test';
import { UnauthorizedException } from '@nestjs/common';
import { buildFindingOrganizationIndexKey } from '@sentris/shared/finding-observation-id';

import { AppController } from '../app.controller';
import type { AuthContext } from '../auth/types';

function makeAuth(organizationId: string): AuthContext {
  return {
    userId: 'user-1',
    organizationId,
    roles: ['ADMIN'],
    isAuthenticated: true,
    provider: 'clerk',
  };
}

describe('AppController analytics tenant identity', () => {
  it('keeps case-distinct organization IDs isolated through the nginx auth boundary', async () => {
    const ensureTenantExists = vi.fn().mockResolvedValue(true);
    const provisioningLock = {
      isProvisioned: vi.fn().mockResolvedValue(false),
      tryAcquire: vi.fn().mockResolvedValue(true),
      markProvisioned: vi.fn().mockResolvedValue(undefined),
      release: vi.fn().mockResolvedValue(undefined),
    };
    const controller = new AppController(
      {
        get: vi.fn((key: string) =>
          key === 'auth'
            ? {
                provider: 'clerk',
                local: { adminUsername: null, adminPassword: null },
                clerk: { publishableKey: null, secretKey: null },
                sessionSecret: undefined,
              }
            : undefined,
        ),
      } as never,
      { ensureTenantExists } as never,
      provisioningLock as never,
    );
    const setHeader = vi.fn();
    const response = { setHeader } as never;

    controller.validateAuth(makeAuth('Org-A'), response);
    controller.validateAuth(makeAuth('org-a'), response);

    const upperKey = buildFindingOrganizationIndexKey('Org-A');
    const lowerKey = buildFindingOrganizationIndexKey('org-a');
    expect(upperKey).not.toBe(lowerKey);
    expect(setHeader).toHaveBeenCalledWith('X-Auth-Organization-Id', upperKey);
    expect(setHeader).toHaveBeenCalledWith('X-Auth-Organization-Id', lowerKey);

    for (let tick = 0; tick < 6; tick += 1) await Promise.resolve();

    expect(provisioningLock.isProvisioned).toHaveBeenCalledWith(upperKey);
    expect(provisioningLock.isProvisioned).toHaveBeenCalledWith(lowerKey);
    expect(ensureTenantExists).toHaveBeenCalledWith('Org-A');
    expect(ensureTenantExists).toHaveBeenCalledWith('org-a');
  });

  it('fails the Dashboards auth request closed when an authenticated session has no organization', () => {
    const controller = new AppController(
      {
        get: vi.fn((key: string) =>
          key === 'auth'
            ? {
                provider: 'clerk',
                local: { adminUsername: null, adminPassword: null },
                clerk: { publishableKey: null, secretKey: null },
                sessionSecret: undefined,
              }
            : undefined,
        ),
      } as never,
      { ensureTenantExists: vi.fn() } as never,
      {
        isProvisioned: vi.fn(),
        tryAcquire: vi.fn(),
        markProvisioned: vi.fn(),
        release: vi.fn(),
      } as never,
    );
    const auth = { ...makeAuth('org-1'), organizationId: null };

    expect(() => controller.validateAuth(auth, { setHeader: vi.fn() } as never)).toThrow(
      UnauthorizedException,
    );
  });
});
