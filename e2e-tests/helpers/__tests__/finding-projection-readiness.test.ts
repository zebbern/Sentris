import { describe, expect, it } from 'bun:test';

import { isExpectedFindingProjectionReady } from '../finding-projection-readiness';

describe('finding projection readiness', () => {
  it('accepts the explicit fail-closed storage state when reconciliation is paused', () => {
    const result = {
      items: [{ id: 'finding-1', scope_id: 'scope-1' }],
      availability: 'degraded',
      degradedReasons: ['storage_id_integrity_unverified'],
    };

    expect(
      isExpectedFindingProjectionReady(
        result,
        'storage-verification-paused',
        (item) => item.scope_id === 'scope-1',
      ),
    ).toBe(true);
  });

  it('rejects any additional degradation while reconciliation is paused', () => {
    const result = {
      items: [{ id: 'finding-1', scope_id: 'scope-1' }],
      availability: 'degraded',
      degradedReasons: ['storage_id_integrity_unverified', 'triage_projection_stale'],
    };

    expect(
      isExpectedFindingProjectionReady(
        result,
        'storage-verification-paused',
        (item) => item.scope_id === 'scope-1',
      ),
    ).toBe(false);
  });

  it('requires a fully available result when storage verification is scheduled', () => {
    const result = {
      items: [{ id: 'finding-1', scope_id: 'scope-1' }],
      availability: 'available',
      degradedReasons: [],
    };

    expect(
      isExpectedFindingProjectionReady(
        result,
        'verified-storage',
        (item) => item.scope_id === 'scope-1',
      ),
    ).toBe(true);
  });

  it('accepts only the storage and triage reasons after triage with reconciliation paused', () => {
    const result = {
      items: [
        {
          id: 'finding-1',
          scope_id: 'scope-1',
          triage: { status: 'triaged', projectionVersion: 1 },
        },
      ],
      availability: 'degraded',
      degradedReasons: ['storage_id_integrity_unverified', 'not_reconciled'],
    };

    expect(
      isExpectedFindingProjectionReady(
        result,
        'storage-and-triage-reconciliation-paused',
        (item) =>
          item.scope_id === 'scope-1' &&
          item.triage.status === 'triaged' &&
          item.triage.projectionVersion === 1,
      ),
    ).toBe(true);
    expect(
      isExpectedFindingProjectionReady(
        {
          ...result,
          degradedReasons: [...result.degradedReasons, 'projection_events_pending'],
        },
        'storage-and-triage-reconciliation-paused',
        (item) => item.scope_id === 'scope-1',
      ),
    ).toBe(false);
  });
});
