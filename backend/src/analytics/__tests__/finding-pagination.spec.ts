import { describe, expect, it } from 'bun:test';

import {
  decodeFindingPageCursor,
  encodeFindingPageCursor,
  findingQueryDigest,
} from '../finding-pagination';

const SECRET = 'test-findings-cursor-secret-with-sufficient-entropy';

describe('finding page cursor', () => {
  it('round-trips an organization and query-bound PIT cursor', () => {
    const queryDigest = findingQueryDigest({
      query: { term: { severity: 'high' } },
      pageSize: 25,
      sortOrder: 'desc',
    });
    const cursor = encodeFindingPageCursor(
      {
        organizationId: 'org-1',
        queryDigest,
        pitId: 'pit-1',
        searchAfter: ['2026-07-26T12:00:00.000Z', 42],
        expiresAt: Date.now() + 60_000,
      },
      SECRET,
    );

    expect(
      decodeFindingPageCursor(cursor, {
        organizationId: 'org-1',
        queryDigest,
        secret: SECRET,
      }),
    ).toEqual(
      expect.objectContaining({
        pitId: 'pit-1',
        searchAfter: ['2026-07-26T12:00:00.000Z', 42],
      }),
    );
  });

  it('round-trips the signed empty search-after position used by page one', () => {
    const queryDigest = findingQueryDigest({
      query: { match_all: {} },
      pageSize: 25,
      sortOrder: 'desc',
    });
    const cursor = encodeFindingPageCursor(
      {
        organizationId: 'org-1',
        queryDigest,
        pitId: 'pit-start',
        searchAfter: [],
        expiresAt: Date.now() + 60_000,
      },
      SECRET,
    );

    expect(
      decodeFindingPageCursor(cursor, {
        organizationId: 'org-1',
        queryDigest,
        secret: SECRET,
      }),
    ).toEqual(expect.objectContaining({ pitId: 'pit-start', searchAfter: [] }));
  });

  it('round-trips null sort values emitted by legacy observation rows', () => {
    const queryDigest = findingQueryDigest({
      query: { match_all: {} },
      pageSize: 25,
      sortOrder: 'desc',
    });
    const cursor = encodeFindingPageCursor(
      {
        organizationId: 'org-1',
        queryDigest,
        pitId: 'pit-legacy',
        searchAfter: [null, 'fo_v1_legacy'],
        expiresAt: Date.now() + 60_000,
      },
      SECRET,
    );

    expect(
      decodeFindingPageCursor(cursor, {
        organizationId: 'org-1',
        queryDigest,
        secret: SECRET,
      }).searchAfter,
    ).toEqual([null, 'fo_v1_legacy']);
  });

  it('rejects tampering, cross-organization reuse, and changed filters', () => {
    const queryDigest = findingQueryDigest({
      query: { match_all: {} },
      pageSize: 25,
      sortOrder: 'desc',
    });
    const cursor = encodeFindingPageCursor(
      {
        organizationId: 'org-1',
        queryDigest,
        pitId: 'pit-1',
        searchAfter: [1],
        expiresAt: Date.now() + 60_000,
      },
      SECRET,
    );
    const [encodedPayload, signature] = cursor.split('.');
    const tamperedPayload = `${encodedPayload![0] === 'A' ? 'B' : 'A'}${encodedPayload!.slice(1)}`;

    expect(() =>
      decodeFindingPageCursor(`${tamperedPayload}.${signature}`, {
        organizationId: 'org-1',
        queryDigest,
        secret: SECRET,
      }),
    ).toThrow();
    expect(() =>
      decodeFindingPageCursor(cursor, {
        organizationId: 'org-2',
        queryDigest,
        secret: SECRET,
      }),
    ).toThrow();
    expect(() =>
      decodeFindingPageCursor(cursor, {
        organizationId: 'org-1',
        queryDigest: 'different-query',
        secret: SECRET,
      }),
    ).toThrow();
  });
});
