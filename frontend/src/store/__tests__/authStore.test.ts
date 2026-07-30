import { beforeEach, describe, expect, it } from 'bun:test';

import { DEFAULT_ORG_ID, useAuthStore } from '../authStore';

describe('authStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.getState().clear();
  });

  it('initializes the trusted-local identity without an authenticated session or token', () => {
    const state = useAuthStore.getState();

    expect(state.organizationId).toBe(DEFAULT_ORG_ID);
    expect(state.token).toBeNull();
    expect(state.roles).toEqual(['ADMIN']);
    expect(state.userId).toBeNull();
    expect(state.provider).toBe('local');
    expect(state.localSessionAuthenticated).toBeFalse();
  });

  it('normalizes tokens and organization ids in memory', () => {
    useAuthStore.getState().setToken('  test-token  ');
    useAuthStore.getState().setOrganizationId('  team-123  ');

    expect(useAuthStore.getState().token).toBe('test-token');
    expect(useAuthStore.getState().organizationId).toBe('team-123');

    useAuthStore.getState().setToken('');
    useAuthStore.getState().setOrganizationId('');

    expect(useAuthStore.getState().token).toBeNull();
    expect(useAuthStore.getState().organizationId).toBe(DEFAULT_ORG_ID);
  });

  it('does not turn an empty remote role set into ADMIN', () => {
    useAuthStore.getState().setProvider('clerk');
    useAuthStore.getState().setRoles([]);

    expect(useAuthStore.getState().roles).toEqual([]);
    expect(useAuthStore.getState().provider).toBe('clerk');
  });

  it('marks a validated local cookie session without storing credentials', () => {
    useAuthStore.getState().setLocalSessionAuthenticated(true);

    const state = useAuthStore.getState();
    expect(state.localSessionAuthenticated).toBeTrue();
    expect(state.userId).toBe('admin');
    expect(state.organizationId).toBe(DEFAULT_ORG_ID);
    expect(state.roles).toEqual(['ADMIN']);
    expect(state.provider).toBe('local');
    expect(state.token).toBeNull();
  });

  it('resets state when cleared', () => {
    useAuthStore.getState().setAuthContext({
      token: 'abc',
      userId: 'user-123',
      organizationId: 'team-42',
      roles: ['MEMBER'],
      provider: 'clerk',
    });

    useAuthStore.getState().clear();

    const state = useAuthStore.getState();
    expect(state.token).toBeNull();
    expect(state.organizationId).toBe(DEFAULT_ORG_ID);
    expect(state.roles).toEqual(['ADMIN']);
    expect(state.userId).toBeNull();
    expect(state.provider).toBe('local');
    expect(state.localSessionAuthenticated).toBeFalse();
  });

  it('fails closed when a remote auth context has no supported roles', () => {
    useAuthStore.getState().setAuthContext({
      token: ' bearer-token ',
      userId: 'user-123',
      organizationId: 'org-777',
      roles: ['MEMBER'],
      provider: 'clerk',
    });
    useAuthStore.getState().setAuthContext({
      token: '',
      userId: '',
      organizationId: null,
      roles: null,
    });

    const state = useAuthStore.getState();
    expect(state.token).toBeNull();
    expect(state.userId).toBeNull();
    expect(state.organizationId).toBe(DEFAULT_ORG_ID);
    expect(state.roles).toEqual([]);
    expect(state.provider).toBe('clerk');
  });
});
