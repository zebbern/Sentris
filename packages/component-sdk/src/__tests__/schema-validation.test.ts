import { describe, it, expect } from 'bun:test';
import { z } from 'zod';
import {
  validateComponentSchema,
  validateParameterSchema,
} from '../schema-validation';
import { withPortMeta } from '../port-meta';
import { param } from '../schema-builders';

// ---------------------------------------------------------------------------
// validateComponentSchema
// ---------------------------------------------------------------------------
describe('validateComponentSchema', () => {
  // ---- Happy paths ----

  it('returns valid for an empty object schema', () => {
    const result = validateComponentSchema(z.object({}));
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns valid for a non-object schema (string, number, etc.)', () => {
    expect(validateComponentSchema(z.string()).valid).toBe(true);
    expect(validateComponentSchema(z.number()).valid).toBe(true);
    expect(validateComponentSchema(z.boolean()).valid).toBe(true);
    expect(validateComponentSchema(z.array(z.string())).valid).toBe(true);
  });

  it('skips fields that have no port metadata', () => {
    const schema = z.object({
      plainField: z.string(), // no withPortMeta
      metaField: withPortMeta(z.string(), { label: 'Meta Field' }),
    });

    const result = validateComponentSchema(schema);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('validates a schema with all primitive port types', () => {
    const schema = z.object({
      text: withPortMeta(z.string(), { label: 'Text' }),
      num: withPortMeta(z.number(), { label: 'Number' }),
      bool: withPortMeta(z.boolean(), { label: 'Bool' }),
    });

    const result = validateComponentSchema(schema);
    expect(result.valid).toBe(true);
  });

  // ---- z.any() / z.unknown() blocking ----

  it('blocks z.unknown() without explicit allowAny', () => {
    const schema = z.object({
      data: withPortMeta(z.unknown(), { label: 'Data' }),
    });

    const result = validateComponentSchema(schema);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('data');
    expect(result.errors[0]).toContain('allowAny=true');
  });

  it('allows z.unknown() with allowAny + reason', () => {
    const schema = z.object({
      data: withPortMeta(z.unknown(), {
        label: 'Data',
        allowAny: true,
        reason: 'Dynamic payload',
      }),
    });

    const result = validateComponentSchema(schema);
    expect(result.valid).toBe(true);
  });

  it('requires reason when allowAny is true for z.any()', () => {
    const schema = z.object({
      field: withPortMeta(z.any(), { allowAny: true }),
    });

    const result = validateComponentSchema(schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('meta.reason'))).toBe(true);
  });

  it('requires reason when allowAny is true for z.unknown()', () => {
    const schema = z.object({
      field: withPortMeta(z.unknown(), { allowAny: true }),
    });

    const result = validateComponentSchema(schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('meta.reason'))).toBe(true);
  });

  // ---- Union type handling ----

  it('errors on union type without connectionType/editor/schemaName', () => {
    const schema = z.object({
      mode: withPortMeta(z.union([z.string(), z.number()]), { label: 'Mode' }),
    });

    const result = validateComponentSchema(schema);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('mode');
    expect(result.errors[0]).toContain('meta.connectionType');
  });

  it('allows union with explicit connectionType (string)', () => {
    const schema = z.object({
      mode: withPortMeta(z.union([z.string(), z.number()]), {
        label: 'Mode',
        connectionType: 'string-or-number',
      }),
    });

    const result = validateComponentSchema(schema);
    expect(result.valid).toBe(true);
  });

  it('allows union with explicit connectionType (object)', () => {
    const schema = z.object({
      mode: withPortMeta(z.union([z.string(), z.number()]), {
        label: 'Mode',
        connectionType: { kind: 'primitive', name: 'text' },
      }),
    });

    const result = validateComponentSchema(schema);
    expect(result.valid).toBe(true);
  });

  it('allows union with editor override', () => {
    const schema = z.object({
      mode: withPortMeta(z.union([z.string(), z.number()]), {
        label: 'Mode',
        editor: 'select',
      }),
    });

    const result = validateComponentSchema(schema);
    expect(result.valid).toBe(true);
  });

  it('allows union with schemaName', () => {
    const schema = z.object({
      mode: withPortMeta(z.union([z.string(), z.number()]), {
        label: 'Mode',
        schemaName: 'StringOrNumber',
      }),
    });

    const result = validateComponentSchema(schema);
    expect(result.valid).toBe(true);
  });

  // ---- Depth checking ----

  it('passes when nesting is within maxDepth', () => {
    const schema = z.object({
      nested: withPortMeta(
        z.object({ inner: z.string() }),
        { label: 'Nested', schemaName: 'Nested' },
      ),
    });

    const result = validateComponentSchema(schema, { maxDepth: 2 });
    expect(result.valid).toBe(true);
  });

  it('fails when nesting exceeds maxDepth', () => {
    const schema = z.object({
      nested: withPortMeta(
        z.object({
          inner: z.object({
            deep: z.string(),
          }),
        }),
        { label: 'Nested', schemaName: 'Nested' },
      ),
    });

    // depth is 3 (object -> object -> string)
    const result = validateComponentSchema(schema, { maxDepth: 2 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('nested'))).toBe(true);
    expect(result.errors.some((e) => e.includes('max depth 2'))).toBe(true);
  });

  it('does not check depth when maxDepth is not specified', () => {
    const schema = z.object({
      nested: withPortMeta(
        z.object({
          a: z.object({
            b: z.object({
              c: z.string(),
            }),
          }),
        }),
        { label: 'Deep', schemaName: 'DeepObj' },
      ),
    });

    // Without maxDepth option, depth validation is skipped
    const result = validateComponentSchema(schema);
    expect(result.valid).toBe(true);
  });

  it('calculates depth correctly for array types', () => {
    const schema = z.object({
      items: withPortMeta(
        z.array(z.object({ name: z.string() })),
        { label: 'Items' },
      ),
    });

    // Array depth = element depth = object{ string } = 2
    const result = validateComponentSchema(schema, { maxDepth: 1 });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('items');
  });

  it('calculates depth correctly for record types', () => {
    const schema = z.object({
      mapping: withPortMeta(
        z.record(z.string(), z.object({ value: z.number() })),
        { label: 'Mapping' },
      ),
    });

    // Record depth = value depth = object{ number } = 2
    const result = validateComponentSchema(schema, { maxDepth: 1 });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('mapping');
  });

  // ---- Unwrapping effects ----

  it('unwraps optional wrapper for z.any() detection', () => {
    const schema = z.object({
      field: withPortMeta(z.any().optional(), { label: 'Field' }),
    });

    const result = validateComponentSchema(schema);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('field');
    expect(result.errors[0]).toContain('allowAny=true');
  });

  it('unwraps nullable wrapper for z.any() detection', () => {
    const schema = z.object({
      field: withPortMeta(z.any().nullable(), { label: 'Field' }),
    });

    const result = validateComponentSchema(schema);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('field');
  });

  it('unwraps default wrapper for z.any() detection', () => {
    const schema = z.object({
      field: withPortMeta(z.any().default(null), { label: 'Field' }),
    });

    const result = validateComponentSchema(schema);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('field');
  });

  it('unwraps effects wrapper for union detection', () => {
    const unionSchema = z.union([z.string(), z.number()]).optional();
    const schema = z.object({
      field: withPortMeta(unionSchema, { label: 'Field' }),
    });

    const result = validateComponentSchema(schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Union types'))).toBe(true);
  });

  // ---- Unwrapping for objects ----

  it('validates through effects-wrapped object schema', () => {
    const innerSchema = z.object({
      val: withPortMeta(z.string(), { label: 'Val' }),
    });
    const wrappedSchema = innerSchema.transform((v) => v);

    const result = validateComponentSchema(wrappedSchema);
    expect(result.valid).toBe(true);
  });

  it('validates through optional-wrapped object schema', () => {
    const innerSchema = z.object({
      val: withPortMeta(z.string(), { label: 'Val' }),
    });
    const wrappedSchema = innerSchema.optional();

    const result = validateComponentSchema(wrappedSchema);
    expect(result.valid).toBe(true);
  });

  // ---- Accumulating multiple errors ----

  it('accumulates multiple errors from different fields', () => {
    const schema = z.object({
      anyField: withPortMeta(z.any(), { label: 'Any' }),
      unknownField: withPortMeta(z.unknown(), { label: 'Unknown' }),
      union: withPortMeta(z.union([z.string(), z.number()]), { label: 'U' }),
    });

    const result = validateComponentSchema(schema);
    expect(result.valid).toBe(false);
    // At minimum: anyField blocked, unknownField blocked, union blocked
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });

  it('reports both allowAny-blocked and missing-reason errors on same field', () => {
    const schema = z.object({
      field: withPortMeta(z.any(), { allowAny: true }), // allowAny but no reason
    });

    const result = validateComponentSchema(schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('meta.reason'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateParameterSchema
// ---------------------------------------------------------------------------
describe('validateParameterSchema', () => {
  it('returns valid for an empty object schema', () => {
    const result = validateParameterSchema(z.object({}));
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns valid for a non-object schema', () => {
    expect(validateParameterSchema(z.string()).valid).toBe(true);
    expect(validateParameterSchema(z.array(z.string())).valid).toBe(true);
  });

  it('validates a properly annotated parameter schema', () => {
    const schema = z.object({
      model: param(z.string(), { label: 'Model', editor: 'select' }),
      retries: param(z.number().optional(), { label: 'Retries', editor: 'number' }),
    });

    const result = validateParameterSchema(schema);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('errors on field missing param() metadata entirely', () => {
    const schema = z.object({
      plain: z.string(), // no param() wrapper
    });

    const result = validateParameterSchema(schema);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('plain');
    expect(result.errors[0]).toContain('param() metadata');
  });

  it('errors when param() metadata is missing label', () => {
    const schema = z.object({
      field: param(z.string(), { editor: 'text' } as any),
    });

    const result = validateParameterSchema(schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('label'))).toBe(true);
  });

  it('errors when param() metadata is missing editor', () => {
    const schema = z.object({
      field: param(z.string(), { label: 'Field' } as any),
    });

    const result = validateParameterSchema(schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('editor'))).toBe(true);
  });

  it('accumulates errors for multiple invalid fields', () => {
    const schema = z.object({
      a: z.string(), // missing param()
      b: z.number(), // missing param()
      c: z.boolean(), // missing param()
    });

    const result = validateParameterSchema(schema);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(3);
  });

  it('validates through effects-wrapped object schema', () => {
    const inner = z.object({
      model: param(z.string(), { label: 'Model', editor: 'select' }),
    });

    const result = validateParameterSchema(inner.transform((v) => v));
    expect(result.valid).toBe(true);
  });
});
