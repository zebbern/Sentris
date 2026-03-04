import { describe, expect, it } from 'bun:test';
import { FindingsStatsResponseSchema, FindingsStatsQuerySchema } from '../dto/findings-stats.dto';

describe('FindingsStatsResponseSchema', () => {
  it('validates well-formed response with severity counts and total', () => {
    const data = {
      severityCounts: [
        { severity: 'critical', count: 5 },
        { severity: 'high', count: 42 },
        { severity: 'medium', count: 100 },
      ],
      total: 147,
    };
    const result = FindingsStatsResponseSchema.parse(data);
    expect(result.severityCounts).toHaveLength(3);
    expect(result.total).toBe(147);
  });

  it('accepts empty severityCounts array', () => {
    const result = FindingsStatsResponseSchema.parse({ severityCounts: [], total: 0 });
    expect(result.severityCounts).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it('rejects missing severityCounts field', () => {
    expect(() => FindingsStatsResponseSchema.parse({ total: 0 })).toThrow();
  });

  it('rejects missing total field', () => {
    expect(() => FindingsStatsResponseSchema.parse({ severityCounts: [] })).toThrow();
  });

  it('rejects negative total', () => {
    expect(() => FindingsStatsResponseSchema.parse({ severityCounts: [], total: -1 })).toThrow();
  });

  it('rejects negative count in severity entry', () => {
    expect(() =>
      FindingsStatsResponseSchema.parse({
        severityCounts: [{ severity: 'high', count: -5 }],
        total: 0,
      }),
    ).toThrow();
  });

  it('rejects non-integer count', () => {
    expect(() =>
      FindingsStatsResponseSchema.parse({
        severityCounts: [{ severity: 'high', count: 3.5 }],
        total: 0,
      }),
    ).toThrow();
  });

  it('validates severity is a string', () => {
    expect(() =>
      FindingsStatsResponseSchema.parse({
        severityCounts: [{ severity: 123, count: 5 }],
        total: 5,
      }),
    ).toThrow();
  });
});

describe('FindingsStatsQuerySchema', () => {
  it('allows empty input (all optional)', () => {
    const result = FindingsStatsQuerySchema.parse({});
    expect(result.severity).toBeUndefined();
    expect(result.search).toBeUndefined();
  });

  it('accepts valid severity filter', () => {
    const result = FindingsStatsQuerySchema.parse({ severity: 'low' });
    expect(result.severity).toBe('low');
  });

  it('rejects invalid severity', () => {
    expect(() => FindingsStatsQuerySchema.parse({ severity: 'unknown' })).toThrow();
  });

  it('rejects search over 200 characters', () => {
    expect(() => FindingsStatsQuerySchema.parse({ search: 'x'.repeat(201) })).toThrow();
  });

  it('accepts workflowId and componentId', () => {
    const result = FindingsStatsQuerySchema.parse({
      workflowId: 'wf-1',
      componentId: 'comp-1',
    });
    expect(result.workflowId).toBe('wf-1');
    expect(result.componentId).toBe('comp-1');
  });
});
