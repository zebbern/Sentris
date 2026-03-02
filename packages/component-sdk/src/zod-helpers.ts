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
