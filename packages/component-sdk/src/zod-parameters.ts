/**
 * Zod Parameter Extraction
 *
 * Derives parameter metadata from Zod schemas with param() metadata.
 */

import { z } from 'zod';
import type { ComponentParameterMetadata } from './types';
import { getParamMeta } from './param-meta';
import {
  type ZodDef,
  getDefType,
  unwrapToObject,
  getObjectShape,
  isOptional,
} from './zod-helpers';

export function extractParameters(schema: z.ZodTypeAny): ComponentParameterMetadata[] {
  const parameters: ComponentParameterMetadata[] = [];
  const objectSchema = unwrapToObject(schema);
  if (!objectSchema) {
    return parameters;
  }
  const shape = getObjectShape(objectSchema);

  for (const [fieldName, fieldSchema] of Object.entries(shape)) {
    const typedSchema = fieldSchema as z.ZodTypeAny;
    const paramMeta = getParamMeta(typedSchema);
    if (!paramMeta) {
      continue;
    }

    const required = !isOptional(typedSchema);
    const defaultValue = getDefaultValue(typedSchema);

    parameters.push({
      id: fieldName,
      label: paramMeta.label || fieldName,
      type: paramMeta.editor,
      required,
      default: defaultValue,
      exposeToTool: paramMeta.exposeToTool,
      placeholder: paramMeta.placeholder,
      description: paramMeta.description,
      helpText: paramMeta.helpText,
      options: paramMeta.options,
      min: paramMeta.min,
      max: paramMeta.max,
      rows: paramMeta.rows,
      visibleWhen: paramMeta.visibleWhen,
    });
  }

  return parameters;
}

function getDefaultValue(schema: z.ZodTypeAny): unknown {
  let current = schema;
  while (true) {
    const def = (current as any)._def as ZodDef | undefined;
    if (!def) {
      return undefined;
    }
    const typeName = getDefType(def);
    if (typeName === 'default') {
      const defaultValue = def.defaultValue;
      if (typeof defaultValue === 'function') {
        return defaultValue();
      }
      return defaultValue;
    }
    if (typeName === 'optional' || typeName === 'nullable') {
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
    return undefined;
  }
}


