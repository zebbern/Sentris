import { describe, it, expect } from 'bun:test';
import { z } from 'zod';
import {
  getDefType,
  getObjectShape,
  getSchemaType,
  isOptional,
  isOptionalForJsonSchema,
  isPrimitiveType,
  LEGACY_TYPE_MAP,
  unwrapEffects,
  unwrapToObject,
} from '../zod-helpers';

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

// ---------------------------------------------------------------------------
// unwrapEffects
// ---------------------------------------------------------------------------
describe('unwrapEffects', () => {
  it('returns a plain schema unchanged', () => {
    const schema = z.string();
    expect(unwrapEffects(schema)).toBe(schema);
  });

  it('unwraps ZodOptional to the inner schema', () => {
    const inner = z.string();
    const wrapped = inner.optional();
    expect(unwrapEffects(wrapped)).toBe(inner);
  });

  it('unwraps ZodNullable to the inner schema', () => {
    const inner = z.number();
    const wrapped = inner.nullable();
    expect(unwrapEffects(wrapped)).toBe(inner);
  });

  it('unwraps ZodDefault to the inner schema', () => {
    const inner = z.string();
    const wrapped = inner.default('hello');
    expect(unwrapEffects(wrapped)).toBe(inner);
  });

  it('unwraps ZodPipeline (e.g., from .transform())', () => {
    const schema = z.string().transform((v) => Number(v));
    const result = unwrapEffects(schema);
    // The pipeline output should be the transformed type (not the original string)
    expect(result).not.toBe(schema);
  });

  it('unwraps multiple layers of wrapping', () => {
    const inner = z.number();
    const wrapped = inner.optional().nullable().default(42);
    const result = unwrapEffects(wrapped);
    expect(result).toBe(inner);
  });

  it('unwraps optional + nullable combination', () => {
    const inner = z.boolean();
    const wrapped = inner.nullable().optional();
    expect(unwrapEffects(wrapped)).toBe(inner);
  });

  it('handles z.object() without wrapping', () => {
    const schema = z.object({ name: z.string() });
    expect(unwrapEffects(schema)).toBe(schema);
  });

  it('unwraps a default-wrapped object', () => {
    const inner = z.object({ count: z.number() });
    const wrapped = inner.default({ count: 0 });
    expect(unwrapEffects(wrapped)).toBe(inner);
  });
});

// ---------------------------------------------------------------------------
// isOptional
// ---------------------------------------------------------------------------
describe('isOptional', () => {
  it('returns false for a plain required string', () => {
    expect(isOptional(z.string())).toBe(false);
  });

  it('returns false for a plain required number', () => {
    expect(isOptional(z.number())).toBe(false);
  });

  it('returns true for ZodOptional', () => {
    expect(isOptional(z.string().optional())).toBe(true);
  });

  it('returns true for ZodDefault (default = not required)', () => {
    expect(isOptional(z.string().default('fallback'))).toBe(true);
  });

  it('returns false for ZodNullable alone (nullable != optional)', () => {
    expect(isOptional(z.string().nullable())).toBe(false);
  });

  it('returns true for nullable wrapping optional', () => {
    expect(isOptional(z.string().optional().nullable())).toBe(true);
  });

  it('returns false for optional hidden inside a transform pipeline', () => {
    // In Zod v4, .transform() creates a ZodPipeline whose output hides the inner optional
    const schema = z.string().optional().transform((v) => v ?? 'default');
    expect(isOptional(schema)).toBe(false);
  });

  it('returns false for a required object', () => {
    expect(isOptional(z.object({ a: z.string() }))).toBe(false);
  });

  it('returns true for an object with default', () => {
    expect(isOptional(z.object({ a: z.string() }).default({ a: '' }))).toBe(true);
  });

  it('returns false for z.any()', () => {
    expect(isOptional(z.any())).toBe(false);
  });

  it('returns false for z.array()', () => {
    expect(isOptional(z.array(z.string()))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isOptionalForJsonSchema
// ---------------------------------------------------------------------------
describe('isOptionalForJsonSchema', () => {
  it('returns false for a plain required string', () => {
    expect(isOptionalForJsonSchema(z.string())).toBe(false);
  });

  it('returns true for ZodOptional', () => {
    expect(isOptionalForJsonSchema(z.string().optional())).toBe(true);
  });

  it('returns false for ZodDefault (default != optional in JSON Schema)', () => {
    expect(isOptionalForJsonSchema(z.string().default('fallback'))).toBe(false);
  });

  it('differs from isOptional for ZodDefault schemas', () => {
    const schema = z.number().default(42);
    expect(isOptional(schema)).toBe(true);
    expect(isOptionalForJsonSchema(schema)).toBe(false);
  });

  it('returns false for ZodNullable alone', () => {
    expect(isOptionalForJsonSchema(z.string().nullable())).toBe(false);
  });

  it('returns true for optional wrapped in nullable', () => {
    expect(isOptionalForJsonSchema(z.string().optional().nullable())).toBe(true);
  });

  it('returns true for optional wrapped in default', () => {
    // z.string().optional().default('x') — outer is default, inner has optional
    expect(isOptionalForJsonSchema(z.string().optional().default('x'))).toBe(true);
  });

  it('returns false for a plain required object', () => {
    expect(isOptionalForJsonSchema(z.object({}))).toBe(false);
  });

  it('returns false for z.number()', () => {
    expect(isOptionalForJsonSchema(z.number())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// unwrapToObject
// ---------------------------------------------------------------------------
describe('unwrapToObject', () => {
  it('returns the schema itself if already a ZodObject', () => {
    const schema = z.object({ name: z.string() });
    expect(unwrapToObject(schema)).toBe(schema);
  });

  it('returns null for a non-object schema (string)', () => {
    expect(unwrapToObject(z.string())).toBeNull();
  });

  it('returns null for an array schema', () => {
    expect(unwrapToObject(z.array(z.string()))).toBeNull();
  });

  it('unwraps optional to find inner ZodObject', () => {
    const inner = z.object({ id: z.number() });
    const wrapped = inner.optional();
    expect(unwrapToObject(wrapped)).toBe(inner);
  });

  it('unwraps nullable to find inner ZodObject', () => {
    const inner = z.object({ id: z.number() });
    const wrapped = inner.nullable();
    expect(unwrapToObject(wrapped)).toBe(inner);
  });

  it('unwraps default to find inner ZodObject', () => {
    const inner = z.object({ count: z.number() });
    const wrapped = inner.default({ count: 0 });
    expect(unwrapToObject(wrapped)).toBe(inner);
  });

  it('unwraps multiple layers to find inner ZodObject', () => {
    const inner = z.object({ flag: z.boolean() });
    const wrapped = inner.optional().nullable();
    expect(unwrapToObject(wrapped)).toBe(inner);
  });

  it('returns null for transform pipeline wrapping an object (pipeline output differs)', () => {
    const inner = z.object({ name: z.string() });
    const wrapped = inner.transform((obj) => ({ ...obj, extra: true }));
    // In Zod v4, .transform() creates a ZodPipeline whose output is not a ZodObject
    expect(unwrapToObject(wrapped)).toBeNull();
  });

  it('returns null for primitive wrapped in optional', () => {
    expect(unwrapToObject(z.string().optional())).toBeNull();
  });

  it('returns null for z.any()', () => {
    expect(unwrapToObject(z.any())).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getObjectShape
// ---------------------------------------------------------------------------
describe('getObjectShape', () => {
  it('returns shape entries from a simple ZodObject', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });
    const shape = getObjectShape(schema);
    expect(Object.keys(shape)).toEqual(['name', 'age']);
    expect(getSchemaType(shape.name)).toBe('string');
    expect(getSchemaType(shape.age)).toBe('number');
  });

  it('returns empty object for a schema with no shape', () => {
    expect(getObjectShape(z.string())).toEqual({});
  });

  it('returns empty object from z.object({})', () => {
    const shape = getObjectShape(z.object({}));
    expect(Object.keys(shape)).toHaveLength(0);
  });

  it('handles object with mixed required and optional fields', () => {
    const schema = z.object({
      required: z.string(),
      optional: z.string().optional(),
      withDefault: z.number().default(0),
    });
    const shape = getObjectShape(schema);
    expect(Object.keys(shape)).toEqual(['required', 'optional', 'withDefault']);
    expect(getSchemaType(shape.optional)).toBe('optional');
    expect(getSchemaType(shape.withDefault)).toBe('default');
  });

  it('handles nested object shapes', () => {
    const schema = z.object({
      nested: z.object({ inner: z.boolean() }),
    });
    const shape = getObjectShape(schema);
    expect(Object.keys(shape)).toEqual(['nested']);
    expect(getSchemaType(shape.nested)).toBe('object');
  });
});

// ---------------------------------------------------------------------------
// isPrimitiveType
// ---------------------------------------------------------------------------
describe('isPrimitiveType', () => {
  it('returns true for z.string()', () => {
    expect(isPrimitiveType(z.string())).toBe(true);
  });

  it('returns true for z.number()', () => {
    expect(isPrimitiveType(z.number())).toBe(true);
  });

  it('returns true for z.boolean()', () => {
    expect(isPrimitiveType(z.boolean())).toBe(true);
  });

  it('returns true for z.bigint()', () => {
    expect(isPrimitiveType(z.bigint())).toBe(true);
  });

  it('returns true for z.date()', () => {
    expect(isPrimitiveType(z.date())).toBe(true);
  });

  it('returns true for z.enum()', () => {
    expect(isPrimitiveType(z.enum(['a', 'b']))).toBe(true);
  });

  it('returns true for z.literal()', () => {
    expect(isPrimitiveType(z.literal('hello'))).toBe(true);
  });

  it('returns false for z.object()', () => {
    expect(isPrimitiveType(z.object({}))).toBe(false);
  });

  it('returns false for z.array()', () => {
    expect(isPrimitiveType(z.array(z.string()))).toBe(false);
  });

  it('returns false for z.record()', () => {
    expect(isPrimitiveType(z.record(z.string(), z.number()))).toBe(false);
  });

  it('returns false for z.union()', () => {
    expect(isPrimitiveType(z.union([z.string(), z.number()]))).toBe(false);
  });

  it('returns false for z.any()', () => {
    expect(isPrimitiveType(z.any())).toBe(false);
  });

  it('returns false for z.unknown()', () => {
    expect(isPrimitiveType(z.unknown())).toBe(false);
  });

  it('returns false for optional-wrapped primitive (reports wrapper type)', () => {
    // isPrimitiveType checks the outermost type, not the unwrapped inner
    expect(isPrimitiveType(z.string().optional())).toBe(false);
  });
});
