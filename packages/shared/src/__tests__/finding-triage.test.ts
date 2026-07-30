import { describe, expect, it } from 'bun:test';
import { z } from 'zod';

import {
  BulkTriageSchema,
  SEVERITY_VALUES,
  SeveritySchema,
  UpdateFindingTriageSchema,
} from '../finding-triage.js';

describe('canonical finding severity', () => {
  it('includes none in the shared severity enum and triage override contract', () => {
    expect(SEVERITY_VALUES).toContain('none');
    expect(SeveritySchema.parse('none')).toBe('none');
    expect(UpdateFindingTriageSchema.parse({ severityOverride: 'none' }).severityOverride).toBe(
      'none',
    );
  });
});

describe('finding triage assignee and bulk identity contracts', () => {
  it('uses null consistently to clear an assignee in single and bulk requests', () => {
    expect(UpdateFindingTriageSchema.parse({ assigneeUserId: null }).assigneeUserId).toBeNull();
    expect(
      BulkTriageSchema.parse({ findingIds: ['finding-1'], assigneeUserId: null }).assigneeUserId,
    ).toBeNull();
  });

  it('rejects an empty assignee identifier', () => {
    expect(UpdateFindingTriageSchema.safeParse({ assigneeUserId: '' }).success).toBe(false);
    expect(
      BulkTriageSchema.safeParse({ findingIds: ['finding-1'], assigneeUserId: '' }).success,
    ).toBe(false);
  });

  it('rejects empty or duplicate finding identifiers in bulk requests', () => {
    expect(BulkTriageSchema.safeParse({ findingIds: [''], status: 'triaged' }).success).toBe(false);
    expect(
      BulkTriageSchema.safeParse({
        findingIds: ['finding-1', 'finding-1'],
        status: 'triaged',
      }).success,
    ).toBe(false);
  });

  it('publishes the bulk uniqueness requirement for generated consumers', () => {
    const jsonSchema = z.toJSONSchema(BulkTriageSchema) as {
      properties?: { findingIds?: { uniqueItems?: boolean } };
    };

    expect(jsonSchema.properties?.findingIds?.uniqueItems).toBe(true);
  });
});
