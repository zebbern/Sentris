import { beforeEach, describe, expect, it } from 'bun:test';

import { useAuthStore } from '../authStore';

describe('authStore persistence boundary', () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.getState().clear();
  });

  it('never persists bearer tokens or local admin credentials', () => {
    useAuthStore.getState().setAuthContext({
      token: 'long-lived-bearer-token',
      userId: 'user-1',
      organizationId: 'org-1',
      roles: ['ADMIN'],
      provider: 'clerk',
    });
    useAuthStore.getState().setLocalSessionAuthenticated(true);

    const persisted = localStorage.getItem('sentris-auth') ?? '';
    expect(persisted).not.toContain('long-lived-bearer-token');
    expect(persisted).not.toContain('localSessionAuthenticated');
  });
});
