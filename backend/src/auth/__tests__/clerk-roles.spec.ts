import { describe, expect, it } from 'bun:test';
import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

import { ClerkAuthProvider, resolveClerkRoles } from '../providers/clerk-auth.provider';

describe('resolveClerkRoles', () => {
  it('normalizes Clerk organization roles', () => {
    expect(resolveClerkRoles('org:admin', 'org-1', 'user-1')).toEqual(['ADMIN']);
    expect(resolveClerkRoles('org_admin', 'org-1', 'user-1')).toEqual(['ADMIN']);
    expect(resolveClerkRoles('org:member', 'org-1', 'user-1')).toEqual(['MEMBER']);
    expect(resolveClerkRoles('member', 'org-1', 'user-1')).toEqual(['MEMBER']);
  });

  it('keeps an explicit personal workspace administrable', () => {
    expect(resolveClerkRoles(undefined, 'workspace-user-1', 'user-1')).toEqual(['ADMIN']);
  });

  it('fails closed for missing or unknown organization roles', () => {
    expect(() => resolveClerkRoles(undefined, 'org-1', 'user-1')).toThrow(UnauthorizedException);
    expect(() => resolveClerkRoles('org:owner', 'org-1', 'user-1')).toThrow(UnauthorizedException);
  });
});

describe('ClerkAuthProvider v2 organization claims', () => {
  it('authenticates the active v2 organization role from o.rol', async () => {
    const provider = new ClerkAuthProvider({
      publishableKey: 'pk_test',
      secretKey: 'sk_test',
    });
    const v2Payload = {
      sub: 'user-1',
      v: 2,
      o: {
        id: 'org-1',
        rol: 'org:admin',
      },
    };
    Object.assign(provider, {
      verifyClerkToken: async () => v2Payload,
    });
    const request = {
      method: 'GET',
      path: '/api/v1/workflows',
      headers: {
        authorization: 'Bearer test-token',
        'x-organization-id': 'org-1',
      },
      cookies: {},
    } as unknown as Request;

    await expect(provider.authenticate(request)).resolves.toMatchObject({
      userId: 'user-1',
      organizationId: 'org-1',
      roles: ['ADMIN'],
      isAuthenticated: true,
      provider: 'clerk',
    });
  });
});
