import { describe, expect, it } from 'bun:test';

import {
  AnalyticsPeriodQuerySchema,
  TopAssigneesQuerySchema,
} from '../dto/triage-analytics.dto';
import { UpsertSlaPoliciesSchema } from '@sentris/shared';

// ---------------------------------------------------------------------------
// AnalyticsPeriodQuerySchema
// ---------------------------------------------------------------------------

describe('AnalyticsPeriodQuerySchema', () => {
  it('accepts "7d"', () => {
    const result = AnalyticsPeriodQuerySchema.safeParse({ period: '7d' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.period).toBe('7d');
    }
  });

  it('accepts "30d"', () => {
    const result = AnalyticsPeriodQuerySchema.safeParse({ period: '30d' });
    expect(result.success).toBe(true);
  });

  it('accepts "90d"', () => {
    const result = AnalyticsPeriodQuerySchema.safeParse({ period: '90d' });
    expect(result.success).toBe(true);
  });

  it('rejects "1d" as invalid period', () => {
    const result = AnalyticsPeriodQuerySchema.safeParse({ period: '1d' });
    expect(result.success).toBe(false);
  });

  it('rejects "365d" as invalid period', () => {
    const result = AnalyticsPeriodQuerySchema.safeParse({ period: '365d' });
    expect(result.success).toBe(false);
  });

  it('rejects empty string', () => {
    const result = AnalyticsPeriodQuerySchema.safeParse({ period: '' });
    expect(result.success).toBe(false);
  });

  it('rejects missing period field', () => {
    const result = AnalyticsPeriodQuerySchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects numeric period', () => {
    const result = AnalyticsPeriodQuerySchema.safeParse({ period: 30 });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TopAssigneesQuerySchema
// ---------------------------------------------------------------------------

describe('TopAssigneesQuerySchema', () => {
  it('coerces string limit to number', () => {
    const result = TopAssigneesQuerySchema.safeParse({ limit: '5' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(5);
    }
  });

  it('applies default limit of 10 when not provided', () => {
    const result = TopAssigneesQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(10);
    }
  });

  it('accepts limit of 1 (minimum)', () => {
    const result = TopAssigneesQuerySchema.safeParse({ limit: 1 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(1);
    }
  });

  it('accepts limit of 50 (maximum)', () => {
    const result = TopAssigneesQuerySchema.safeParse({ limit: 50 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(50);
    }
  });

  it('rejects limit of 0 (below min)', () => {
    const result = TopAssigneesQuerySchema.safeParse({ limit: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects limit of 51 (above max)', () => {
    const result = TopAssigneesQuerySchema.safeParse({ limit: 51 });
    expect(result.success).toBe(false);
  });

  it('rejects negative limit', () => {
    const result = TopAssigneesQuerySchema.safeParse({ limit: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer limit', () => {
    const result = TopAssigneesQuerySchema.safeParse({ limit: 5.5 });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// UpsertSlaPoliciesSchema
// ---------------------------------------------------------------------------

describe('UpsertSlaPoliciesSchema', () => {
  it('accepts valid policies array', () => {
    const result = UpsertSlaPoliciesSchema.safeParse({
      policies: [
        { severity: 'critical', deadlineHours: 24 },
        { severity: 'high', deadlineHours: 72 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty policies array', () => {
    const result = UpsertSlaPoliciesSchema.safeParse({ policies: [] });
    expect(result.success).toBe(true);
  });

  it('accepts max 5 policies (one per severity)', () => {
    const result = UpsertSlaPoliciesSchema.safeParse({
      policies: [
        { severity: 'critical', deadlineHours: 24 },
        { severity: 'high', deadlineHours: 48 },
        { severity: 'medium', deadlineHours: 168 },
        { severity: 'low', deadlineHours: 720 },
        { severity: 'info', deadlineHours: 8760 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects more than 5 policies', () => {
    const result = UpsertSlaPoliciesSchema.safeParse({
      policies: [
        { severity: 'critical', deadlineHours: 24 },
        { severity: 'high', deadlineHours: 48 },
        { severity: 'medium', deadlineHours: 168 },
        { severity: 'low', deadlineHours: 720 },
        { severity: 'info', deadlineHours: 8760 },
        { severity: 'critical', deadlineHours: 12 }, // 6th entry
      ],
    });
    expect(result.success).toBe(false);
  });

  it('validates deadlineHours minimum (1)', () => {
    const result = UpsertSlaPoliciesSchema.safeParse({
      policies: [{ severity: 'critical', deadlineHours: 1 }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects deadlineHours of 0', () => {
    const result = UpsertSlaPoliciesSchema.safeParse({
      policies: [{ severity: 'critical', deadlineHours: 0 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative deadlineHours', () => {
    const result = UpsertSlaPoliciesSchema.safeParse({
      policies: [{ severity: 'critical', deadlineHours: -10 }],
    });
    expect(result.success).toBe(false);
  });

  it('validates deadlineHours maximum (8760)', () => {
    const result = UpsertSlaPoliciesSchema.safeParse({
      policies: [{ severity: 'critical', deadlineHours: 8760 }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects deadlineHours above 8760', () => {
    const result = UpsertSlaPoliciesSchema.safeParse({
      policies: [{ severity: 'critical', deadlineHours: 8761 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid severity value', () => {
    const result = UpsertSlaPoliciesSchema.safeParse({
      policies: [{ severity: 'invalid', deadlineHours: 24 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing severity field', () => {
    const result = UpsertSlaPoliciesSchema.safeParse({
      policies: [{ deadlineHours: 24 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing deadlineHours field', () => {
    const result = UpsertSlaPoliciesSchema.safeParse({
      policies: [{ severity: 'critical' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer deadlineHours', () => {
    const result = UpsertSlaPoliciesSchema.safeParse({
      policies: [{ severity: 'critical', deadlineHours: 24.5 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing policies field entirely', () => {
    const result = UpsertSlaPoliciesSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
