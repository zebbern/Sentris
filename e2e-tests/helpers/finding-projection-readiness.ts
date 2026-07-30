export type FindingProjectionReadinessMode =
  'verified-storage' | 'storage-verification-paused' | 'storage-and-triage-reconciliation-paused';

export interface FindingProjectionResult<T> {
  items?: T[];
  availability?: string;
  degradedReasons?: string[];
}

export function isExpectedFindingProjectionReady<T>(
  result: FindingProjectionResult<T>,
  mode: FindingProjectionReadinessMode,
  itemPredicate: (item: T) => boolean,
): boolean {
  if (result.items?.some(itemPredicate) !== true) return false;
  if (mode === 'verified-storage') {
    return result.availability === 'available' && (result.degradedReasons?.length ?? 0) === 0;
  }
  const expectedReasons =
    mode === 'storage-and-triage-reconciliation-paused'
      ? ['storage_id_integrity_unverified', 'not_reconciled']
      : ['storage_id_integrity_unverified'];
  const actualReasons = result.degradedReasons ?? [];
  return (
    result.availability === 'degraded' &&
    actualReasons.length === expectedReasons.length &&
    expectedReasons.every((reason) => actualReasons.includes(reason))
  );
}
