/**
 * Shared Zod Schema Helpers
 *
 * Common type-introspection utilities used across the component-sdk
 * for extracting type information from Zod schema internals.
 */

import type { z } from 'zod';

/** Loose shape of `schema._def` across Zod versions */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Zod internals are untyped
export type ZodDef = { type?: string; typeName?: string; [key: string]: any };

/**
 * Maps Zod internal `typeName` values to short, stable type names
 * used throughout the component-sdk typing system.
 */
export const LEGACY_TYPE_MAP: Record<string, string> = {
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

/** Resolve the short type name from a Zod `_def` object. */
export function getDefType(def: ZodDef | undefined): string | undefined {
  const raw = def?.type ?? def?.typeName;
  return raw ? LEGACY_TYPE_MAP[raw] ?? raw : undefined;
}

/** Convenience wrapper: extract the short type name directly from a schema. */
export function getSchemaType(schema: z.ZodTypeAny): string | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accessing Zod internals
  return getDefType((schema as any)._def);
}

/**
 * Unwrap optional, nullable, default, effects, and pipe wrappers
 * to reach the core schema underneath.
 */
export function unwrapEffects(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current = schema;

  while (true) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Zod internals
    const def = (current as any)._def as ZodDef | undefined;

    if (!def) break;

    const typeName = getDefType(def);

    if (typeName === 'optional' || typeName === 'nullable' || typeName === 'default') {
      current = def.innerType;
      continue;
    }

    if (typeName === 'effects') {
      current = def.schema;
      continue;
    }

    if (typeName === 'pipe') {
      current = def.out ?? def.schema ?? def.innerType ?? def.in ?? current;
      if (current === schema) break;
      continue;
    }

    break;
  }

  return current;
}

/**
 * Unwrap a schema through optional/nullable/default/effects/pipe wrappers
 * and return the inner `ZodObject` if one is found, or `null`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Zod internals
export function unwrapToObject(schema: z.ZodTypeAny): z.ZodObject<any, any> | null {
  let current = schema;

  while (true) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Zod internals
    const def = (current as any)._def as ZodDef | undefined;
    const typeName = getDefType(def);

    if (!def) {
      return null;
    }

    if (typeName === 'object') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Zod internals
      return current as z.ZodObject<any, any>;
    }

    if (typeName === 'optional' || typeName === 'nullable' || typeName === 'default') {
      current = def.innerType;
      continue;
    }

    if (typeName === 'effects') {
      current = def.schema;
      continue;
    }

    if (typeName === 'pipe') {
      current = def.out ?? def.schema ?? def.innerType ?? def.in ?? current;
      continue;
    }

    return null;
  }
}

/**
 * Extract the property shape from a `ZodObject` schema,
 * handling both lazy (function) and eager shape formats.
 */
export function getObjectShape(schema: z.ZodTypeAny): Record<string, z.ZodTypeAny> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Zod internals
  const shape = (schema as any).shape;
  if (typeof shape === 'function') {
    return shape();
  }
  return shape ?? {};
}

/**
 * Check if a schema is optional — treats both `ZodOptional` and `ZodDefault`
 * as optional (a field with a default value does not need to be supplied).
 *
 * Use this for port/parameter extraction where "has a default" means "not required".
 * For JSON Schema `required` semantics, see {@link isOptionalForJsonSchema}.
 */
export function isOptional(schema: z.ZodTypeAny): boolean {
  let current = schema;
  while (true) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Zod internals
    const def = (current as any)._def as ZodDef | undefined;
    if (!def) {
      return false;
    }
    const typeName = getDefType(def);
    if (typeName === 'optional' || typeName === 'default') {
      return true;
    }
    if (typeName === 'nullable' || typeName === 'effects') {
      current = typeName === 'effects' ? def.schema : def.innerType;
      continue;
    }
    if (typeName === 'pipe') {
      current = def.out ?? def.schema ?? def.innerType ?? def.in ?? current;
      continue;
    }
    return false;
  }
}

/**
 * Check if a schema is optional in the JSON Schema `required`-array sense.
 *
 * Unlike {@link isOptional}, this does **not** treat `ZodDefault` as optional —
 * a field with a default is still listed in `required` because the schema
 * expects a value (the default is applied during parsing, not at the schema level).
 */
export function isOptionalForJsonSchema(schema: z.ZodTypeAny): boolean {
  let current = schema;

  while (true) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Zod internals
    const def = (current as any)._def as ZodDef | undefined;

    if (!def) break;

    const typeName = getDefType(def);

    if (typeName === 'optional') {
      return true;
    }

    if (typeName === 'default' || typeName === 'nullable') {
      current = def.innerType;
      continue;
    }

    break;
  }

  return false;
}

/**
 * Check if a schema represents a primitive type
 * (string, number, boolean, bigint, date, symbol, enum, or literal).
 */
export function isPrimitiveType(schema: z.ZodTypeAny): boolean {
  const typeName = getSchemaType(schema);
  return ['string', 'number', 'boolean', 'bigint', 'date', 'symbol', 'enum', 'literal'].includes(
    typeName ?? ''
  );
}
