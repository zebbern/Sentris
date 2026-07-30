import { describe, expect, it } from 'bun:test';
import { buildFindingObservationIndexName } from '@sentris/shared/finding-observation-id';

import { EnsureTenantSchema } from '../dto/analytics-tenant.dto';

describe('EnsureTenantSchema exact organization identity', () => {
  it('preserves leading and trailing whitespace as exact, distinct identity bytes', () => {
    const exact = EnsureTenantSchema.parse({ organizationId: ' Org-A ' });

    expect(exact.organizationId).toBe(' Org-A ');
    expect(buildFindingObservationIndexName(exact.organizationId)).not.toBe(
      buildFindingObservationIndexName('Org-A'),
    );
  });

  it.each(['', '   ', '\t', 'org\nid', `org${String.fromCharCode(0x7f)}id`, 'org\ud800id'])(
    'rejects empty, all-whitespace, control-invalid, or malformed Unicode organization ID %j',
    (organizationId) => {
      expect(EnsureTenantSchema.safeParse({ organizationId }).success).toBe(false);
    },
  );
});
