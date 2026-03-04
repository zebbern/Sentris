import { describe, expect, it } from 'bun:test';
import { FindingsExportQuerySchema } from '../dto/findings-export.dto';

describe('FindingsExportQuerySchema', () => {
  it('applies correct defaults for empty input', () => {
    const result = FindingsExportQuerySchema.parse({});
    expect(result.format).toBe('json');
    expect(result.limit).toBe(1000);
    expect(result.sortOrder).toBe('desc');
    expect(result.severity).toBeUndefined();
    expect(result.search).toBeUndefined();
  });

  it('accepts csv format', () => {
    const result = FindingsExportQuerySchema.parse({ format: 'csv' });
    expect(result.format).toBe('csv');
  });

  it('accepts json format', () => {
    const result = FindingsExportQuerySchema.parse({ format: 'json' });
    expect(result.format).toBe('json');
  });

  it('rejects invalid format', () => {
    expect(() => FindingsExportQuerySchema.parse({ format: 'xml' })).toThrow();
  });

  it('rejects invalid format value (number)', () => {
    expect(() => FindingsExportQuerySchema.parse({ format: 123 })).toThrow();
  });

  it('coerces string limit to number', () => {
    const result = FindingsExportQuerySchema.parse({ limit: '500' });
    expect(result.limit).toBe(500);
  });

  it('accepts limit at minimum boundary (1)', () => {
    const result = FindingsExportQuerySchema.parse({ limit: 1 });
    expect(result.limit).toBe(1);
  });

  it('accepts limit at maximum boundary (10000)', () => {
    const result = FindingsExportQuerySchema.parse({ limit: 10000 });
    expect(result.limit).toBe(10000);
  });

  it('rejects limit below range (0)', () => {
    expect(() => FindingsExportQuerySchema.parse({ limit: 0 })).toThrow();
  });

  it('rejects limit above range (10001)', () => {
    expect(() => FindingsExportQuerySchema.parse({ limit: 10001 })).toThrow();
  });

  it('inherits severity validation from common fields', () => {
    const result = FindingsExportQuerySchema.parse({ severity: 'critical' });
    expect(result.severity).toBe('critical');
  });

  it('rejects invalid severity', () => {
    expect(() => FindingsExportQuerySchema.parse({ severity: 'unknown' })).toThrow();
  });

  it('inherits search validation — rejects over 200 chars', () => {
    expect(() => FindingsExportQuerySchema.parse({ search: 'x'.repeat(201) })).toThrow();
  });

  it('accepts valid search text', () => {
    const result = FindingsExportQuerySchema.parse({ search: 'sql injection' });
    expect(result.search).toBe('sql injection');
  });

  it('accepts workflowId and componentId', () => {
    const result = FindingsExportQuerySchema.parse({
      workflowId: 'wf-abc',
      componentId: 'comp-xyz',
    });
    expect(result.workflowId).toBe('wf-abc');
    expect(result.componentId).toBe('comp-xyz');
  });

  it('accepts valid datetime strings for dateFrom and dateTo', () => {
    const result = FindingsExportQuerySchema.parse({
      dateFrom: '2025-01-01T00:00:00Z',
      dateTo: '2025-12-31T23:59:59Z',
    });
    expect(result.dateFrom).toBe('2025-01-01T00:00:00Z');
    expect(result.dateTo).toBe('2025-12-31T23:59:59Z');
  });
});
