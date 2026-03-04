import { describe, expect, it } from 'bun:test';
import { FindingsQuerySchema, FindingsResponseSchema } from '../dto/findings-query.dto';

describe('FindingsQuerySchema', () => {
  it('applies defaults for empty input', () => {
    const result = FindingsQuerySchema.parse({});
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(25);
    expect(result.sortOrder).toBe('desc');
    expect(result.severity).toBeUndefined();
    expect(result.search).toBeUndefined();
  });

  it('coerces string numbers to integers', () => {
    const result = FindingsQuerySchema.parse({ page: '3', pageSize: '50' });
    expect(result.page).toBe(3);
    expect(result.pageSize).toBe(50);
  });

  it('accepts valid severity values', () => {
    const severities = ['critical', 'high', 'medium', 'low', 'info'] as const;
    for (const sev of severities) {
      const result = FindingsQuerySchema.parse({ severity: sev });
      expect(result.severity).toBe(sev);
    }
  });

  it('rejects invalid severity values', () => {
    expect(() => FindingsQuerySchema.parse({ severity: 'unknown' })).toThrow();
  });

  it('rejects page < 1', () => {
    expect(() => FindingsQuerySchema.parse({ page: 0 })).toThrow();
  });

  it('rejects pageSize > 100', () => {
    expect(() => FindingsQuerySchema.parse({ pageSize: 101 })).toThrow();
  });

  it('rejects search longer than 200 chars', () => {
    expect(() => FindingsQuerySchema.parse({ search: 'x'.repeat(201) })).toThrow();
  });

  it('accepts valid search string', () => {
    const result = FindingsQuerySchema.parse({ search: 'nuclei scan' });
    expect(result.search).toBe('nuclei scan');
  });
});

describe('FindingsResponseSchema', () => {
  it('validates a well-formed response', () => {
    const response = {
      items: [
        {
          id: 'abc123',
          timestamp: '2025-06-15T12:00:00.000Z',
          severity: 'high',
          name: 'SQL Injection',
          asset_key: 'example.com',
          workflow_name: 'Web Scan',
          workflow_id: 'wf-1',
          run_id: 'run-1',
          component_id: 'comp-1',
          node_ref: 'node-1',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 25,
    };
    const result = FindingsResponseSchema.parse(response);
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it('allows items with minimal fields', () => {
    const response = {
      items: [{ id: 'x', timestamp: '2025-01-01T00:00:00Z' }],
      total: 1,
      page: 1,
      pageSize: 25,
    };
    const result = FindingsResponseSchema.parse(response);
    expect(result.items[0].id).toBe('x');
  });

  it('rejects negative total', () => {
    expect(() =>
      FindingsResponseSchema.parse({ items: [], total: -1, page: 1, pageSize: 25 }),
    ).toThrow();
  });
});
