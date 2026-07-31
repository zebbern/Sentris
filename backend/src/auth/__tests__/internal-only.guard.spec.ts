import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'bun:test';

import { InternalOnlyGuard } from '../internal-only.guard';

function context(auth: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ auth }),
    }),
  } as never;
}

describe('InternalOnlyGuard', () => {
  const guard = new InternalOnlyGuard();

  it('allows only the authenticated internal-service credential boundary', () => {
    expect(
      guard.canActivate(
        context({
          userId: 'internal-service',
          organizationId: 'org-1',
          roles: ['ADMIN', 'MEMBER'],
          isAuthenticated: true,
          provider: 'internal',
        }),
      ),
    ).toBe(true);
  });

  it.each([
    undefined,
    { userId: 'user-1', isAuthenticated: true, provider: 'clerk' },
    { userId: 'key-1', isAuthenticated: true, provider: 'api-key' },
    { userId: 'internal-service', isAuthenticated: false, provider: 'internal' },
  ])('rejects missing, user, API-key, and unauthenticated contexts %#', (auth) => {
    expect(() => guard.canActivate(context(auth))).toThrow(ForbiddenException);
  });
});
