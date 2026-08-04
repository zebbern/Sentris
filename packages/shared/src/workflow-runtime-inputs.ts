import { z } from 'zod';

export const WORKFLOW_RUNTIME_INPUT_TYPES = [
  'file',
  'text',
  'number',
  'boolean',
  'json',
  'array',
  'secret',
] as const;

export const WorkflowRuntimeInputTypeSchema = z.enum(WORKFLOW_RUNTIME_INPUT_TYPES);
export type WorkflowRuntimeInputType = z.infer<typeof WorkflowRuntimeInputTypeSchema>;

export const WorkflowRuntimeInputDefinitionObjectSchema = z.object({
  id: z.string().trim().min(1).describe('Unique identifier for this input'),
  label: z.string().trim().min(1).describe('Display label for the input field'),
  type: WorkflowRuntimeInputTypeSchema.describe('Type of input data'),
  required: z.boolean().default(true).describe('Whether this input is required'),
  description: z.string().optional().describe('Help text for the input'),
  defaultValue: z.unknown().optional().describe('Default value to use when input is omitted'),
});

export const WorkflowRuntimeInputDefinitionSchema = z.preprocess((value) => {
  if (typeof value !== 'object' || value === null || !('type' in value)) return value;
  const input = value as Record<string, unknown>;
  return input.type === 'string' ? { ...input, type: 'text' } : input;
}, WorkflowRuntimeInputDefinitionObjectSchema);

export const WorkflowRuntimeInputDefinitionsSchema = z
  .array(WorkflowRuntimeInputDefinitionSchema)
  .superRefine((definitions, context) => {
    const seen = new Set<string>();
    for (const [index, definition] of definitions.entries()) {
      if (seen.has(definition.id)) {
        context.addIssue({
          code: 'custom',
          path: [index, 'id'],
          message: `Duplicate runtime input ID "${definition.id}"`,
        });
      }
      seen.add(definition.id);
    }
  });

export type WorkflowRuntimeInputDefinition = z.infer<typeof WorkflowRuntimeInputDefinitionSchema>;

export const WorkflowRuntimeInputDescriptorSchema = z
  .object({
    id: z.string().trim().min(1),
    label: z.string().trim().min(1),
    type: WorkflowRuntimeInputTypeSchema,
    required: z.boolean(),
    description: z.string().optional(),
    hasDefaultValue: z.boolean(),
  })
  .strict();

export type WorkflowRuntimeInputDescriptor = z.infer<typeof WorkflowRuntimeInputDescriptorSchema>;

export type WorkflowRuntimeInputValidationIssue =
  | {
      code: 'missing_required';
      inputId: string;
      label: string;
      expectedType: WorkflowRuntimeInputType;
      message: string;
    }
  | {
      code: 'invalid_type';
      inputId: string;
      label: string;
      expectedType: WorkflowRuntimeInputType;
      message: string;
    }
  | {
      code: 'unknown_input';
      inputId: string;
      message: string;
    };

export interface WorkflowRuntimeInputValidationResult {
  valid: boolean;
  issues: WorkflowRuntimeInputValidationIssue[];
  expectedInputs: WorkflowRuntimeInputDescriptor[];
  receivedInputIds: string[];
}

interface WorkflowDefinitionLike {
  entrypoint?: { ref?: string };
  actions?: Array<{
    ref?: string;
    componentId?: string;
    params?: Record<string, unknown>;
  }>;
}

export function extractWorkflowRuntimeInputDefinitions(
  definition: WorkflowDefinitionLike,
): WorkflowRuntimeInputDefinition[] {
  const actions = Array.isArray(definition.actions) ? definition.actions : [];
  const entrypoint = actions.find(
    (action) =>
      action.ref === definition.entrypoint?.ref ||
      action.componentId === 'core.workflow.entrypoint' ||
      action.componentId === 'entry-point',
  );
  if (!entrypoint) return [];
  return WorkflowRuntimeInputDefinitionsSchema.parse(entrypoint.params?.runtimeInputs ?? []);
}

export function hasWorkflowRuntimeInputDefault(
  definition: WorkflowRuntimeInputDefinition,
): boolean {
  return (
    Object.prototype.hasOwnProperty.call(definition, 'defaultValue') &&
    definition.defaultValue !== undefined &&
    definition.defaultValue !== null
  );
}

export function describeWorkflowRuntimeInputs(
  definitions: WorkflowRuntimeInputDefinition[],
): WorkflowRuntimeInputDescriptor[] {
  return definitions.map((definition) => ({
    id: definition.id,
    label: definition.label,
    type: definition.type,
    required: definition.required,
    ...(definition.description ? { description: definition.description } : {}),
    hasDefaultValue: hasWorkflowRuntimeInputDefault(definition),
  }));
}

export function workflowRuntimeInputValueSchema(type: WorkflowRuntimeInputType): z.ZodTypeAny {
  switch (type) {
    case 'number':
      return z.number();
    case 'boolean':
      return z.boolean();
    case 'array':
      return z.array(z.string());
    case 'file':
    case 'secret':
    case 'text':
      return z.string();
    case 'json':
      return z.unknown();
    default: {
      const exhaustive: never = type;
      throw new Error(`Unsupported workflow runtime input type: ${String(exhaustive)}`);
    }
  }
}

export function validateWorkflowRuntimeInputs(
  definitions: WorkflowRuntimeInputDefinition[],
  inputs: Record<string, unknown>,
): WorkflowRuntimeInputValidationResult {
  const issues: WorkflowRuntimeInputValidationIssue[] = [];
  const expectedIds = new Set(definitions.map((definition) => definition.id));
  const receivedInputIds = Object.keys(inputs).sort();

  // Workflows with no declared inputs retain the existing behavior of ignoring the
  // arbitrary runtime data record. Once a contract exists, misspelled keys are errors.
  if (definitions.length > 0) {
    for (const inputId of receivedInputIds) {
      if (!expectedIds.has(inputId)) {
        issues.push({
          code: 'unknown_input',
          inputId,
          message: `Unknown workflow runtime input "${inputId}"`,
        });
      }
    }
  }

  for (const definition of definitions) {
    const suppliedValue = inputs[definition.id];
    const effectiveValue =
      (suppliedValue === undefined || suppliedValue === null) &&
      hasWorkflowRuntimeInputDefault(definition)
        ? definition.defaultValue
        : suppliedValue;

    if (effectiveValue === undefined) {
      if (definition.required) {
        issues.push({
          code: 'missing_required',
          inputId: definition.id,
          label: definition.label,
          expectedType: definition.type,
          message: `Required workflow runtime input "${definition.label}" (${definition.id}) was not provided`,
        });
      }
      continue;
    }

    if (!workflowRuntimeInputValueSchema(definition.type).safeParse(effectiveValue).success) {
      issues.push({
        code: 'invalid_type',
        inputId: definition.id,
        label: definition.label,
        expectedType: definition.type,
        message: `Workflow runtime input "${definition.label}" (${definition.id}) must be ${definition.type}`,
      });
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    expectedInputs: describeWorkflowRuntimeInputs(definitions),
    receivedInputIds,
  };
}

export function formatWorkflowRuntimeInputValidationError(
  result: WorkflowRuntimeInputValidationResult,
): string {
  const issueSummary = result.issues.map((issue) => issue.message).join('; ');
  const expectedSummary = result.expectedInputs
    .map(
      (input) =>
        `${input.id} (${input.type}${input.required && !input.hasDefaultValue ? ', required' : ''})`,
    )
    .join(', ');
  return [
    issueSummary || 'Workflow runtime inputs are invalid',
    `Expected inputs: ${expectedSummary || 'none'}`,
    `Received input IDs: ${result.receivedInputIds.join(', ') || 'none'}`,
  ].join('. ');
}
