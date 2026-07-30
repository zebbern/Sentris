import { describe, expect, it } from 'bun:test';
import { z } from 'zod';

import { BulkTriageSchema } from '../dto/bulk-triage.dto';
import { TriageUpdateSchema } from '../dto/triage-update.dto';

describe('finding triage request DTOs', () => {
  it('uses null consistently to clear an assignee in single and bulk requests', () => {
    expect(TriageUpdateSchema.parse({ assigneeUserId: null }).assigneeUserId).toBeNull();
    expect(
      BulkTriageSchema.parse({ findingIds: ['finding-1'], assigneeUserId: null }).assigneeUserId,
    ).toBeNull();
  });

  it('rejects empty assignee identifiers and finding identifiers', () => {
    expect(TriageUpdateSchema.safeParse({ assigneeUserId: '' }).success).toBe(false);
    expect(
      BulkTriageSchema.safeParse({ findingIds: ['finding-1'], assigneeUserId: '' }).success,
    ).toBe(false);
    expect(BulkTriageSchema.safeParse({ findingIds: [''], status: 'triaged' }).success).toBe(false);
  });

  it('rejects duplicate finding identifiers', () => {
    expect(
      BulkTriageSchema.safeParse({
        findingIds: ['finding-1', 'finding-1'],
        status: 'triaged',
      }).success,
    ).toBe(false);
  });

  it('publishes the runtime uniqueness requirement in the generated schema', () => {
    const jsonSchema = z.toJSONSchema(BulkTriageSchema) as {
      properties?: { findingIds?: { uniqueItems?: boolean } };
    };

    expect(jsonSchema.properties?.findingIds?.uniqueItems).toBe(true);
  });
});
