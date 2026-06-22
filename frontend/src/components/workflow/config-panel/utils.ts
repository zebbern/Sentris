import type { FrontendNodeData } from '@/schemas/node';
import type { JsonSchemaProperty, ToolSchemaField } from './types';
import type { Node } from '@xyflow/react';

/** Build a sample value for an entry-point runtime input, used in example payloads. */
export const buildSampleValueForRuntimeInput = (type?: string, id?: string) => {
  switch (type) {
    case 'number':
      return 0;
    case 'boolean':
      return false;
    case 'json':
      return { example: true };
    case 'array':
      return ['value-1'];
    case 'file':
      return 'upload-file-id';
    case 'text':
    default:
      return id ? `${id}-value` : 'value';
  }
};

/** Parse a component's toolSchema into display-ready formats. */
export function parseToolSchema(toolSchema: unknown): {
  toolSchemaJson: string | null;
  toolSchemaFields: ToolSchemaField[];
} {
  // Serialize to JSON string
  let toolSchemaJson: string | null = null;
  if (toolSchema) {
    if (typeof toolSchema === 'string') {
      toolSchemaJson = toolSchema;
    } else {
      try {
        toolSchemaJson = JSON.stringify(toolSchema, null, 2);
      } catch {
        toolSchemaJson = String(toolSchema);
      }
    }
  }

  // Parse to object
  let toolSchemaObject: Record<string, unknown> | null = null;
  if (toolSchema) {
    if (typeof toolSchema === 'string') {
      try {
        toolSchemaObject = JSON.parse(toolSchema);
      } catch {
        /* ignore */
      }
    } else if (typeof toolSchema === 'object') {
      toolSchemaObject = toolSchema as Record<string, unknown>;
    }
  }

  // Extract fields
  const properties = toolSchemaObject?.properties ?? {};
  const required = new Set((toolSchemaObject?.required as string[]) ?? []);
  const toolSchemaFields = Object.entries(properties).map(([id, schema]) => {
    const typed = schema as JsonSchemaProperty;
    const type =
      typeof typed.type === 'string'
        ? typed.type
        : Array.isArray(typed.type)
          ? typed.type.join(' | ')
          : 'object';
    return {
      id,
      type,
      description: typed.description,
      required: required.has(id),
      defaultValue: typed.default,
      enumValues: Array.isArray(typed.enum) ? typed.enum : undefined,
    };
  });

  return { toolSchemaJson, toolSchemaFields };
}

/** Build a config params updater — returns the new config or null if no update needed. */
export function buildUpdatedParams(
  selectedNode: Node<FrontendNodeData>,
  paramId: string,
  value: unknown,
): { config: FrontendNodeData['config'] } {
  const config = selectedNode.data.config || { params: {}, inputOverrides: {} };
  let updatedParams = { ...(config.params ?? {}) };
  if (value === undefined) {
    const { [paramId]: _removed, ...rest } = updatedParams;
    updatedParams = rest;
  } else {
    updatedParams[paramId] = value;
  }
  return { config: { ...config, params: updatedParams } };
}

/** Build a config input-override updater. */
export function buildUpdatedInputOverrides(
  selectedNode: Node<FrontendNodeData>,
  inputId: string,
  value: unknown,
): { config: FrontendNodeData['config'] } {
  const config = selectedNode.data.config || { params: {}, inputOverrides: {} };
  let updatedOverrides = { ...(config.inputOverrides ?? {}) };
  if (value === undefined) {
    const { [inputId]: _removed, ...rest } = updatedOverrides;
    updatedOverrides = rest;
  } else {
    updatedOverrides[inputId] = value;
  }
  return { config: { ...config, inputOverrides: updatedOverrides } };
}
