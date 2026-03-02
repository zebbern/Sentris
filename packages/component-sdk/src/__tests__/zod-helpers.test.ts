import { describe, it, expect } from 'bun:test';
import { z } from 'zod';
import { getDefType, getSchemaType, LEGACY_TYPE_MAP } from '../zod-helpers';

// ---------------------------------------------------------------------------
// LEGACY_TYPE_MAP
// ---------------------------------------------------------------------------
describe('LEGACY_TYPE_MAP', () => {
  it('maps all expected Zod internal type names', () => {
    const expected: Record<string, string> = {
      ZodString: 'string',
      ZodNumber: 'number',
      ZodBoolean: 'boolean',
      ZodBigInt: 'bigint',
      ZodDate: 'date',
      ZodSymbol: 'symbol',
      ZodAny: 'any',
      ZodUnknown: 'unknown',
      ZodObject: 'object',
      ZodArray: 'array',
      ZodRecord: 'record',
      ZodUnion: 'union',
      ZodDiscriminatedUnion: 'union',
      ZodOptional: 'optional',
      ZodNullable: 'nullable',
      ZodDefault: 'default',
      ZodEffects: 'effects',
      ZodPipeline: 'pipe',
      ZodLiteral: 'literal',
      ZodEnum: 'enum',
      ZodNativeEnum: 'nativeEnum',
    };

    for (const [zodName, shortName] of Object.entries(expected)) {
      expect(LEGACY_TYPE_MAP[zodName]).toBe(shortName);
    }
  });
});

// ---------------------------------------------------------------------------
// getDefType
// ---------------------------------------------------------------------------
describe('getDefType', () => {
  it('returns undefined for undefined def', () => {
    expect(getDefType(undefined)).toBeUndefined();
  });

  it('returns undefined for def without type or typeName', () => {
    expect(getDefType({})).toBeUndefined();
  });

  it('resolves typeName through the legacy map', () => {
    expect(getDefType({ typeName: 'ZodString' })).toBe('string');
    expect(getDefType({ typeName: 'ZodArray' })).toBe('array');
    expect(getDefType({ typeName: 'ZodObject' })).toBe('object');
  });

  it('resolves type field through the legacy map', () => {
    expect(getDefType({ type: 'ZodNumber' })).toBe('number');
    expect(getDefType({ type: 'ZodBoolean' })).toBe('boolean');
  });

  it('returns raw value if not in legacy map', () => {
    expect(getDefType({ typeName: 'CustomZodType' })).toBe('CustomZodType');
  });

  it('prefers type over typeName when both exist', () => {
    // `def.type ?? def.typeName` — type has priority
    expect(getDefType({ type: 'ZodString', typeName: 'ZodNumber' })).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// getSchemaType
// ---------------------------------------------------------------------------
describe('getSchemaType', () => {
  it('returns "string" for z.string()', () => {
    expect(getSchemaType(z.string())).toBe('string');
  });

  it('returns "number" for z.number()', () => {
    expect(getSchemaType(z.number())).toBe('number');
  });

  it('returns "boolean" for z.boolean()', () => {
    expect(getSchemaType(z.boolean())).toBe('boolean');
  });

  it('returns "object" for z.object()', () => {
    expect(getSchemaType(z.object({}))).toBe('object');
  });

  it('returns "array" for z.array()', () => {
    expect(getSchemaType(z.array(z.string()))).toBe('array');
  });

  it('returns "optional" for z.string().optional()', () => {
    expect(getSchemaType(z.string().optional())).toBe('optional');
  });

  it('returns "nullable" for z.string().nullable()', () => {
    expect(getSchemaType(z.string().nullable())).toBe('nullable');
  });

  it('returns "default" for z.string().default("")', () => {
    expect(getSchemaType(z.string().default(''))).toBe('default');
  });

  it('returns "pipe" for z.string().transform() (Zod v4 creates ZodPipeline)', () => {
    expect(getSchemaType(z.string().transform((v) => v))).toBe('pipe');
  });

  it('refine() preserves the underlying type in this Zod version', () => {
    // In Zod v4, .refine() attaches checks inline rather than wrapping in ZodEffects
    expect(getSchemaType(z.string().refine((v) => v.length > 0))).toBe('string');
  });

  it('returns "any" for z.any()', () => {
    expect(getSchemaType(z.any())).toBe('any');
  });

  it('returns "unknown" for z.unknown()', () => {
    expect(getSchemaType(z.unknown())).toBe('unknown');
  });

  it('returns "union" for z.union()', () => {
    expect(getSchemaType(z.union([z.string(), z.number()]))).toBe('union');
  });

  it('returns "record" for z.record()', () => {
    expect(getSchemaType(z.record(z.string(), z.number()))).toBe('record');
  });

  it('returns "enum" for z.enum()', () => {
    expect(getSchemaType(z.enum(['a', 'b']))).toBe('enum');
  });

  it('returns "literal" for z.literal()', () => {
    expect(getSchemaType(z.literal('x'))).toBe('literal');
  });

  it('returns "bigint" for z.bigint()', () => {
    expect(getSchemaType(z.bigint())).toBe('bigint');
  });

  it('returns "date" for z.date()', () => {
    expect(getSchemaType(z.date())).toBe('date');
  });
});
