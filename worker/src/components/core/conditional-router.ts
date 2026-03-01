import { z } from 'zod';
import {
  componentRegistry,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
} from '@sentris/component-sdk';

const inputSchema = inputs({
  value: port(z.unknown(), {
    label: 'Value',
    description: 'Value to evaluate',
    allowAny: true,
    reason: 'Router accepts any value type for flexible conditional branching.',
    connectionType: { kind: 'primitive', name: 'json' },
  }),
});

const outputSchema = outputs({
  matched: port(z.unknown(), {
    label: 'Matched (True)',
    description: 'Output when condition matches',
    allowAny: true,
    reason: 'Passes through the original value unchanged.',
    connectionType: { kind: 'primitive', name: 'json' },
    isBranching: true,
    branchColor: 'green',
  }),
  unmatched: port(z.unknown(), {
    label: 'Unmatched (False)',
    description: 'Output when condition does not match',
    allowAny: true,
    reason: 'Passes through the original value unchanged.',
    connectionType: { kind: 'primitive', name: 'json' },
    isBranching: true,
    branchColor: 'red',
  }),
});

type ConditionType =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'greater_than'
  | 'less_than'
  | 'regex'
  | 'is_empty'
  | 'is_not_empty'
  | 'is_truthy';

const parameterSchema = parameters({
  conditionType: param(
    z
      .enum([
        'equals',
        'not_equals',
        'contains',
        'not_contains',
        'greater_than',
        'less_than',
        'regex',
        'is_empty',
        'is_not_empty',
        'is_truthy',
      ])
      .default('equals'),
    {
      label: 'Condition Type',
      editor: 'select',
      description: 'How to evaluate the input value.',
      options: [
        { label: 'Equals', value: 'equals' },
        { label: 'Not Equals', value: 'not_equals' },
        { label: 'Contains', value: 'contains' },
        { label: 'Not Contains', value: 'not_contains' },
        { label: 'Greater Than', value: 'greater_than' },
        { label: 'Less Than', value: 'less_than' },
        { label: 'Regex Match', value: 'regex' },
        { label: 'Is Empty', value: 'is_empty' },
        { label: 'Is Not Empty', value: 'is_not_empty' },
        { label: 'Is Truthy', value: 'is_truthy' },
      ],
    },
  ),
  compareValue: param(z.string().optional(), {
    label: 'Compare Value',
    editor: 'text',
    description: 'Value to compare against (not needed for is_empty/is_truthy).',
  }),
  jsonPath: param(z.string().optional(), {
    label: 'JSON Path',
    editor: 'text',
    description: 'Optional dot path to extract from value (e.g., "status", "data.count").',
  }),
});

/**
 * Extract a nested value from an object using a dot-separated path.
 */
function extractByPath(obj: unknown, path: string): unknown {
  const segments = path.split('.');
  let current: unknown = obj;

  for (const segment of segments) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }

  return current;
}

/**
 * Check whether a value is considered "empty":
 * null, undefined, empty string, or empty array.
 */
function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' && value.length === 0) return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

/**
 * Evaluate a condition against the extracted value.
 */
function evaluateCondition(
  conditionType: ConditionType,
  extractedValue: unknown,
  compareValue: string | undefined,
): boolean {
  switch (conditionType) {
    case 'equals':
      return String(extractedValue) === (compareValue ?? '');
    case 'not_equals':
      return String(extractedValue) !== (compareValue ?? '');
    case 'contains':
      return String(extractedValue ?? '').includes(compareValue ?? '');
    case 'not_contains':
      return !String(extractedValue ?? '').includes(compareValue ?? '');
    case 'greater_than':
      return Number(extractedValue) > Number(compareValue);
    case 'less_than':
      return Number(extractedValue) < Number(compareValue);
    case 'regex': {
      if (!compareValue) return false;
      try {
        const re = new RegExp(compareValue);
        return re.test(String(extractedValue ?? ''));
      } catch {
        return false;
      }
    }
    case 'is_empty':
      return isEmpty(extractedValue);
    case 'is_not_empty':
      return !isEmpty(extractedValue);
    case 'is_truthy':
      return Boolean(extractedValue);
  }
}

const definition = defineComponent({
  id: 'sentris.conditional-router.run',
  label: 'Conditional Router',
  category: 'process',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Routes workflow data to different output branches based on configurable conditions. Only the matching branch receives data, enabling conditional execution of downstream nodes.',
  ui: {
    slug: 'conditional-router',
    version: '1.0.0',
    type: 'process',
    category: 'process',
    description: 'Route data to different branches based on conditions.',
    icon: 'GitBranch',
    author: {
      name: 'SentrisAI',
      type: 'sentris',
    },
    isLatest: true,
    deprecated: false,
    examples: [
      'Route high-severity findings to Slack notifications while logging low-severity ones.',
      'Branch workflow based on HTTP status codes from API responses.',
      'Filter empty scan results to skip unnecessary downstream processing.',
    ],
  },
  async execute({ inputs, params }, context) {
    const { conditionType, compareValue, jsonPath } = params;
    const rawValue = inputs.value;

    // Extract nested value if jsonPath is specified
    const extractedValue =
      jsonPath && jsonPath.trim().length > 0 ? extractByPath(rawValue, jsonPath.trim()) : rawValue;

    const isMatch = evaluateCondition(conditionType, extractedValue, compareValue);

    context.logger.info(
      `[ConditionalRouter] Condition "${conditionType}" evaluated to ${isMatch}` +
        (jsonPath ? ` (path: ${jsonPath})` : ''),
    );

    context.emitProgress({
      message: `Condition "${conditionType}" → ${isMatch ? 'matched' : 'unmatched'}`,
      level: 'info',
      data: { conditionType, isMatch, jsonPath: jsonPath ?? null },
    });

    return {
      matched: isMatch ? rawValue : null,
      unmatched: isMatch ? null : rawValue,
    };
  },
});

componentRegistry.register(definition);

export default definition;
