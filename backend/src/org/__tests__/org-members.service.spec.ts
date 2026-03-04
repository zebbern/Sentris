import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import { OrgMembersService, type OrgMember } from '../org-members.service';
import type { ConfigService } from '@nestjs/config';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeConfigService(clerkSecret: string | null = 'sk_test_abc123'): ConfigService {
  return {
    get: (key: string) => {
      if (key === 'auth') {
        return { clerk: { secretKey: clerkSecret } };
      }
      return undefined;
    },
  } as unknown as ConfigService;
}

const MOCK_CLERK_RESPONSE = {
  data: [
    {
      public_user_data: {
        user_id: 'user-1',
        first_name: 'Jane',
        last_name: 'Engineer',
        identifier: 'jane@example.com',
        image_url: 'https://img.example.com/jane.jpg',
      },
      role: 'admin',
    },
    {
      public_user_data: {
        user_id: 'user-2',
        first_name: 'Bob',
        last_name: null,
        identifier: 'bob@example.com',
        image_url: null,
      },
      role: 'member',
    },
  ],
  total_count: 2,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OrgMembersService', () => {
  let service: OrgMembersService;
  let fetchMock: ReturnType<typeof mock>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchMock = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(MOCK_CLERK_RESPONSE),
        text: () => Promise.resolve(''),
      }),
    );
    globalThis.fetch = fetchMock as any;

    service = new OrgMembersService(makeConfigService());
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns org members from Clerk API', async () => {
    const members = await service.listMembers('org-1');

    expect(members).toHaveLength(2);
    expect(members[0]).toEqual({
      userId: 'user-1',
      displayName: 'Jane Engineer',
      email: 'jane@example.com',
      role: 'ADMIN',
      avatarUrl: 'https://img.example.com/jane.jpg',
    });
    expect(members[1]).toEqual({
      userId: 'user-2',
      displayName: 'Bob',
      email: 'bob@example.com',
      role: 'MEMBER',
      avatarUrl: null,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0]![0] as string;
    expect(calledUrl).toContain('organizations/org-1/memberships');
  });

  it('caches results on second call (does not hit API again)', async () => {
    await service.listMembers('org-1');
    await service.listMembers('org-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('separates caches per organization', async () => {
    await service.listMembers('org-1');
    await service.listMembers('org-2');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns empty array when Clerk secret key is not configured', async () => {
    const serviceNoKey = new OrgMembersService(makeConfigService(null));

    const members = await serviceNoKey.listMembers('org-1');

    expect(members).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns empty array on Clerk API failure (without cached data)', async () => {
    fetchMock.mockReturnValue(
      Promise.resolve({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      }),
    );

    const members = await service.listMembers('org-1');

    expect(members).toEqual([]);
  });

  it('returns stale cache on Clerk API failure when cached data exists', async () => {
    // First call succeeds
    await service.listMembers('org-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Expire the cache by manipulating internals
    const cache = (service as any).cache as Map<
      string,
      { members: OrgMember[]; expiresAt: number }
    >;
    const entry = cache.get('org-1')!;
    entry.expiresAt = Date.now() - 1000; // Force expiry

    // Second call fails
    fetchMock.mockReturnValue(
      Promise.resolve({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      }),
    );

    const members = await service.listMembers('org-1');

    expect(members).toHaveLength(2);
    expect(members[0]!.userId).toBe('user-1');
  });

  it('sends authorization header with Clerk secret key', async () => {
    await service.listMembers('org-1');

    const calledOpts = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(calledOpts.headers).toBeDefined();
    expect((calledOpts.headers as Record<string, string>).Authorization).toBe(
      'Bearer sk_test_abc123',
    );
  });

  it('handles members with no first or last name', async () => {
    fetchMock.mockReturnValue(
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [
              {
                public_user_data: {
                  user_id: 'user-x',
                  first_name: null,
                  last_name: null,
                  identifier: 'x@example.com',
                  image_url: null,
                },
                role: 'member',
              },
            ],
            total_count: 1,
          }),
        text: () => Promise.resolve(''),
      }),
    );

    const members = await service.listMembers('org-x');

    expect(members[0]!.displayName).toBe('Unknown');
  });
});
