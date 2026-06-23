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
  items: port(
    z.array(z.unknown()).describe('Items to iterate — one loop body execution per item.'),
    {
      label: 'Items',
      description: 'List of values to process. Each item runs the connected loop body once.',
      allowAny: true,
      reason: 'Loop items may be plain strings, package specs, or structured JSON objects.',
      connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
    },
  ),
});

const outputSchema = outputs({
  currentItem: port(z.unknown(), {
    label: 'Current Item',
    description: 'The item for the active loop body iteration.',
    allowAny: true,
    reason: 'Loop items may be strings, objects, or other JSON values.',
    connectionType: { kind: 'primitive', name: 'json' },
    isBranching: true,
    branchColor: 'blue',
  }),
  index: port(z.number(), {
    label: 'Index',
    description: 'Zero-based index of the current iteration.',
    isBranching: true,
    branchColor: 'blue',
  }),
  total: port(z.number(), {
    label: 'Total',
    description: 'Total number of items in this loop run.',
    isBranching: true,
    branchColor: 'blue',
  }),
  results: port(z.array(z.unknown()), {
    label: 'Results',
    description: 'Collected iteration outputs after the loop completes.',
    allowAny: true,
    reason: 'Each iteration may emit a different JSON shape.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
    isBranching: true,
    branchColor: 'green',
  }),
  iterations: port(z.number(), {
    label: 'Iterations',
    description: 'Number of completed loop iterations.',
    isBranching: true,
    branchColor: 'green',
  }),
});

const parameterSchema = parameters({
  maxIterations: param(
    z.number().int().positive().optional().describe('Optional cap on loop iterations.'),
    {
      label: 'Max Iterations',
      editor: 'number',
      min: 1,
      description: 'When set, only the first N items are processed.',
    },
  ),
});

const definition = defineComponent({
  id: 'core.workflow.for-each',
  label: 'For Each',
  category: 'transform',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Iterate over a list and run a loop body once per item. Connect the body port to the first body node and loop the last body node back to loopBack.',
  ui: {
    slug: 'for-each',
    version: '1.0.0',
    type: 'process',
    category: 'transform',
    description: 'Repeat a workflow section for each item in a list.',
    icon: 'Repeat',
    author: { name: 'SentrisAI', type: 'sentris' },
    isLatest: true,
    deprecated: false,
    examples: [
      'Process each npm package spec through a Claude Code hunt and review pipeline.',
      'Run the same enrichment steps for every URL in a list.',
    ],
  },
  async execute() {
    throw new Error(
      'core.workflow.for-each must be executed by the workflow orchestrator (sentrisWorkflowRun or workflow-runner)',
    );
  },
});

componentRegistry.register(definition);

export default definition;
