import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { coerceJsonFromText, coerceNumberFromText } from '../zod-coerce';

describe('coerceJsonFromText', () => {
  const recordSchema = coerceJsonFromText(z.record(z.string(), z.unknown()).default({}));

  it('parses JSON object strings', () => {
    const result = recordSchema.parse('{"plugins": ["superpowers"]}');
    expect(result).toEqual({ plugins: ['superpowers'] });
  });

  it('passes through objects unchanged', () => {
    const value = { enabled: true };
    expect(recordSchema.parse(value)).toEqual(value);
  });

  it('treats empty strings as undefined and applies default', () => {
    expect(recordSchema.parse('')).toEqual({});
    expect(recordSchema.parse('   ')).toEqual({});
  });
});

describe('coerceNumberFromText', () => {
  it('parses numeric strings', () => {
    expect(coerceNumberFromText().parse('42')).toBe(42);
  });
});
