import { describe, expect, it } from 'bun:test';
import { FindingIdParamSchema, FindingDetailResponseSchema } from '../dto/findings-detail.dto';

describe('FindingIdParamSchema', () => {
  it('accepts a valid non-empty string', () => {
    const result = FindingIdParamSchema.parse({ id: 'abc-123' });
    expect(result.id).toBe('abc-123');
  });

  it('accepts a long string ID', () => {
    const result = FindingIdParamSchema.parse({ id: 'x'.repeat(100) });
    expect(result.id).toHaveLength(100);
  });

  it('rejects an empty string', () => {
    expect(() => FindingIdParamSchema.parse({ id: '' })).toThrow();
  });

  it('rejects missing id field', () => {
    expect(() => FindingIdParamSchema.parse({})).toThrow();
  });
});

describe('FindingDetailResponseSchema', () => {
  const validFinding = {
    id: 'finding-001',
    timestamp: '2025-06-15T12:00:00.000Z',
    severity: 'high',
    name: 'SQL Injection',
    asset_key: 'example.com',
    workflow_name: 'Web Scan',
    workflow_id: 'wf-1',
    run_id: 'run-1',
    component_id: 'comp-1',
    node_ref: 'node-1',
    raw: { '@timestamp': '2025-06-15T12:00:00.000Z', severity: 'high', custom_field: 42 },
  };

  it('validates a complete finding with required raw field', () => {
    const result = FindingDetailResponseSchema.parse(validFinding);
    expect(result.id).toBe('finding-001');
    expect(result.raw).toEqual(validFinding.raw);
  });

  it('requires the raw field (not optional)', () => {
    const { raw: _raw, ...withoutRaw } = validFinding;
    expect(() => FindingDetailResponseSchema.parse(withoutRaw)).toThrow();
  });

  it('accepts raw with arbitrary keys', () => {
    const finding = { ...validFinding, raw: { foo: 'bar', nested: { a: 1 }, arr: [1, 2, 3] } };
    const result = FindingDetailResponseSchema.parse(finding);
    expect(result.raw.foo).toBe('bar');
  });

  it('allows optional fields to be absent', () => {
    const minimal = {
      id: 'min-1',
      timestamp: '2025-01-01T00:00:00Z',
      raw: { key: 'value' },
    };
    const result = FindingDetailResponseSchema.parse(minimal);
    expect(result.id).toBe('min-1');
    expect(result.severity).toBeUndefined();
    expect(result.name).toBeUndefined();
  });
});
