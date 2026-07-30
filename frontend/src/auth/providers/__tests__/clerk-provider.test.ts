import { describe, expect, it } from 'bun:test';

import { resolveActiveClerkOrganization } from '../clerk-provider';

describe('resolveActiveClerkOrganization', () => {
  const memberships = [
    { organization: { id: 'org-first', name: 'First' }, role: 'org:member' },
    { organization: { id: 'org-active', name: 'Active' }, role: 'org:admin' },
  ];

  it('uses the active Clerk organization instead of the first membership', () => {
    expect(resolveActiveClerkOrganization('org-active', 'org:admin', memberships)).toEqual({
      organizationId: 'org-active',
      organizationName: 'Active',
      organizationRole: 'org:admin',
    });
  });

  it('returns no organization when Clerk has no active organization', () => {
    expect(resolveActiveClerkOrganization(undefined, undefined, memberships)).toEqual({
      organizationId: undefined,
      organizationName: undefined,
      organizationRole: undefined,
    });
  });
});
