import { describe, expect, it } from 'bun:test';

import {
  WorkflowRuntimeInputDefinitionsSchema,
  describeWorkflowRuntimeInputs,
  extractWorkflowRuntimeInputDefinitions,
  validateWorkflowRuntimeInputs,
} from '../workflow-runtime-inputs.js';

describe('workflow runtime inputs', () => {
  it('normalizes legacy text definitions and hides default values from descriptors', () => {
    const definitions = WorkflowRuntimeInputDefinitionsSchema.parse([
      {
        id: ' packageSpec ',
        label: ' npm package ',
        type: 'string',
        defaultValue: 'private-default',
      },
    ]);

    expect(describeWorkflowRuntimeInputs(definitions)).toEqual([
      {
        id: 'packageSpec',
        label: 'npm package',
        type: 'text',
        required: true,
        hasDefaultValue: true,
      },
    ]);
  });

  it('extracts the exact entrypoint contract from a compiled definition', () => {
    const definitions = extractWorkflowRuntimeInputDefinitions({
      entrypoint: { ref: 'start' },
      actions: [
        {
          ref: 'start',
          componentId: 'core.workflow.entrypoint',
          params: {
            runtimeInputs: [
              {
                id: 'packageSpec',
                label: 'npm package and optional version',
                type: 'text',
                required: true,
              },
            ],
          },
        },
      ],
    });

    expect(definitions).toEqual([
      {
        id: 'packageSpec',
        label: 'npm package and optional version',
        type: 'text',
        required: true,
      },
    ]);
  });

  it('reports missing, unknown, and invalid typed values without echoing values', () => {
    const definitions = WorkflowRuntimeInputDefinitionsSchema.parse([
      { id: 'packageSpec', label: 'Package', type: 'text', required: true },
      { id: 'deep', label: 'Deep scan', type: 'boolean', required: false },
    ]);

    const result = validateWorkflowRuntimeInputs(definitions, {
      package: 'minimist@1.2.5',
      deep: 'yes',
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'unknown_input', inputId: 'package' }),
      expect.objectContaining({ code: 'missing_required', inputId: 'packageSpec' }),
      expect.objectContaining({ code: 'invalid_type', inputId: 'deep' }),
    ]);
    expect(JSON.stringify(result)).not.toContain('minimist@1.2.5');
  });

  it('accepts omitted inputs backed by defaults and typed supplied values', () => {
    const definitions = WorkflowRuntimeInputDefinitionsSchema.parse([
      {
        id: 'packageSpec',
        label: 'Package',
        type: 'text',
        required: true,
        defaultValue: 'minimist@1.2.8',
      },
      { id: 'deep', label: 'Deep scan', type: 'boolean', required: false },
      { id: 'tags', label: 'Tags', type: 'array', required: false },
    ]);

    expect(
      validateWorkflowRuntimeInputs(definitions, {
        deep: true,
        tags: ['npm', 'security'],
      }),
    ).toEqual(expect.objectContaining({ valid: true, issues: [] }));
  });

  it('rejects duplicate IDs after normalization', () => {
    expect(() =>
      WorkflowRuntimeInputDefinitionsSchema.parse([
        { id: 'target', label: 'Target', type: 'text' },
        { id: 'target', label: 'Other target', type: 'text' },
      ]),
    ).toThrow('Duplicate runtime input ID');
  });
});
