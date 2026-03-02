/**
 * JSON Schema Generation from Zod
 *
 * Generates tool/operation JSON schemas from Zod schemas.
 * This is for future tool integration, not used in current workflow execution.
 */

import { z } from 'zod';
import { type ZodDef, getDefType, getObjectShape, isOptionalForJsonSchema } from './zod-helpers';

/**
 * Generate JSON schema from Zod schema
 *
 * @param schema - Zod schema to convert
 * @returns JSON Schema object
 */
export function generateJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const jsonSchema = zodToJsonSchema(schema);

  return jsonSchema;
}

/**
 * Convert Zod schema to JSON Schema format
 * Simplified implementation - may use zod-to-json-schema for complex cases
 */
function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const def = (schema as any)._def as ZodDef | undefined;
  const typeName = getDefType(def);

  // Handle ZodObject
  if (typeName === 'object') {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, field] of Object.entries(getObjectShape(schema))) {
      const fieldSchema = field as z.ZodTypeAny;
      properties[key] = zodToJsonSchema(fieldSchema);

      // Check if field is required
      if (!isOptionalForJsonSchema(fieldSchema)) {
        required.push(key);
      }
    }

    return {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
    };
  }

  // Handle ZodString
  if (typeName === 'string') {
    return { type: 'string' };
  }

  // Handle ZodNumber
  if (typeName === 'number') {
    return { type: 'number' };
  }

  // Handle ZodBoolean
  if (typeName === 'boolean') {
    return { type: 'boolean' };
  }

  // Handle ZodArray
  if (typeName === 'array') {
    const element = (def as any).element ?? (def as any).type;
    return {
      type: 'array',
      items: element ? zodToJsonSchema(element) : {},
    };
  }

  // Handle ZodRecord
  if (typeName === 'record') {
    const valueType = (def as any).valueType ?? (def as any).value ?? (def as any).keyType;
    return {
      type: 'object',
      additionalProperties: valueType ? zodToJsonSchema(valueType) : {},
    };
  }

  // Handle ZodUnion
  if (typeName === 'union') {
    const options = (def as any).options.map((opt: z.ZodTypeAny) => zodToJsonSchema(opt));
    return {
      anyOf: options,
    };
  }

  // Handle ZodAny / ZodUnknown
  if (typeName === 'any' || typeName === 'unknown') {
    return {};
  }

  // Handle ZodLiteral
  if (typeName === 'literal') {
    return {
      type: typeof (def as any).value,
      const: (def as any).value,
    };
  }

  // Handle ZodEnum
  if (typeName === 'enum' || typeName === 'nativeEnum') {
    return {
      type: typeof (def as any).values[0],
      enum: (def as any).values,
    };
  }

  // Handle ZodOptional
  if (typeName === 'optional') {
    return zodToJsonSchema((def as any).innerType);
  }

  // Handle ZodNullable
  if (typeName === 'nullable') {
    return {
      anyOf: [
        zodToJsonSchema((def as any).innerType),
        { type: 'null' },
      ],
    };
  }

  // Handle ZodDefault
  if (typeName === 'default') {
    const innerSchema = zodToJsonSchema((def as any).innerType);
    innerSchema.default = (def as any).defaultValue();
    return innerSchema;
  }

  if (typeName === 'effects' || typeName === 'pipe') {
    const next = (def as any).out ?? (def as any).schema ?? (def as any).innerType ?? (def as any).in;
    if (next) {
      return zodToJsonSchema(next);
    }
  }

  // Fallback: treat as unknown
  return {};
}


