import { describe, expect, it } from 'bun:test';

import '@sentris/worker/components';
import { WorkflowGraphDto } from '../../workflows/dto/workflow-graph.dto';
import { compileWorkflowGraph } from '../compiler';

describe('extractLoopBodies', () => {
  it('extracts loop body nodes and allows cyclic loop-back edges', () => {
    const graph: WorkflowGraphDto = {
      name: 'Loop sample',
      nodes: [
        {
          id: 'trigger',
          type: 'core.workflow.entrypoint',
          position: { x: 0, y: 0 },
          data: {
            label: 'Trigger',
            config: {
              params: {
                runtimeInputs: [{ id: 'items', label: 'Items', type: 'array', required: true }],
              },
              inputOverrides: {},
            },
          },
        },
        {
          id: 'loop',
          type: 'core.workflow.for-each',
          position: { x: 0, y: 100 },
          data: {
            label: 'Loop',
            config: { params: {}, inputOverrides: {} },
          },
        },
        {
          id: 'body_step',
          type: 'core.logic.script',
          position: { x: 0, y: 200 },
          data: {
            label: 'Body',
            config: {
              params: {
                variables: [
                  { name: 'currentItem', type: 'string' },
                  { name: 'value', type: 'string' },
                ],
                returns: [{ name: 'result', type: 'json' }],
                code: 'export function script(input) { return { result: { item: input.currentItem, value: input.value } }; }',
              },
              inputOverrides: { value: 'seed' },
            },
          },
        },
        {
          id: 'finalize',
          type: 'core.logic.script',
          position: { x: 0, y: 300 },
          data: {
            label: 'Finalize',
            config: {
              params: {
                variables: [{ name: 'results', type: 'list-json' }],
                returns: [{ name: 'report', type: 'json' }],
                code: 'export function script(input) { return { report: { count: Array.isArray(input.results) ? input.results.length : 0 } }; }',
              },
              inputOverrides: {},
            },
          },
        },
      ],
      edges: [
        {
          id: 'trigger-loop-items',
          source: 'trigger',
          target: 'loop',
          sourceHandle: 'items',
          targetHandle: 'items',
        },
        {
          id: 'loop-body',
          source: 'loop',
          target: 'body_step',
          sourceHandle: 'body',
          targetHandle: 'currentItem',
        },
        {
          id: 'body-loop-back',
          source: 'body_step',
          target: 'loop',
          sourceHandle: 'result',
          targetHandle: 'loopBack',
        },
        {
          id: 'loop-finalize-results',
          source: 'loop',
          target: 'finalize',
          sourceHandle: 'results',
          targetHandle: 'results',
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    };

    const compiled = compileWorkflowGraph(graph);
    expect(compiled.actions.map((action) => action.ref)).toEqual(['trigger', 'loop', 'finalize']);
    expect(compiled.loopBodies?.loop).toBeDefined();
    expect(compiled.loopBodies?.loop.bodyEntryRef).toBe('body_step');
    expect(compiled.loopBodies?.loop.definition.actions.map((action) => action.ref)).toEqual([
      'body_step',
    ]);
  });
});

describe('compileWorkflowGraph for-each', () => {
  it('compiles workflows with an in-graph For Each loop', () => {
    const graph: WorkflowGraphDto = {
      name: 'Loop workflow',
      description: 'for-each',
      nodes: [
        {
          id: 'trigger',
          type: 'core.workflow.entrypoint',
          position: { x: 0, y: 0 },
          data: {
            label: 'Trigger',
            config: {
              params: {
                runtimeInputs: [{ id: 'items', label: 'Items', type: 'array', required: true }],
              },
              inputOverrides: {},
            },
          },
        },
        {
          id: 'loop',
          type: 'core.workflow.for-each',
          position: { x: 0, y: 100 },
          data: {
            label: 'Loop',
            config: { params: {}, inputOverrides: {} },
          },
        },
        {
          id: 'body_step',
          type: 'core.logic.script',
          position: { x: 0, y: 200 },
          data: {
            label: 'Body',
            config: {
              params: {
                variables: [{ name: 'currentItem', type: 'string' }],
                returns: [{ name: 'result', type: 'json' }],
                code: 'export function script(input) { return { result: { item: input.currentItem } }; }',
              },
              inputOverrides: {},
            },
          },
        },
        {
          id: 'finalize',
          type: 'core.logic.script',
          position: { x: 0, y: 300 },
          data: {
            label: 'Finalize',
            config: {
              params: {
                variables: [{ name: 'results', type: 'list-json' }],
                returns: [{ name: 'report', type: 'json' }],
                code: 'export function script(input) { return { report: { items: input.results || [] } }; }',
              },
              inputOverrides: {},
            },
          },
        },
      ],
      edges: [
        {
          id: 'trigger-loop-items',
          source: 'trigger',
          target: 'loop',
          sourceHandle: 'items',
          targetHandle: 'items',
        },
        {
          id: 'loop-body',
          source: 'loop',
          target: 'body_step',
          sourceHandle: 'body',
          targetHandle: 'currentItem',
        },
        {
          id: 'body-loop-back',
          source: 'body_step',
          target: 'loop',
          sourceHandle: 'result',
          targetHandle: 'loopBack',
        },
        {
          id: 'loop-finalize-results',
          source: 'loop',
          target: 'finalize',
          sourceHandle: 'results',
          targetHandle: 'results',
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    };

    const compiled = compileWorkflowGraph(graph);
    expect(compiled.loopBodies?.loop).toBeDefined();
    expect(compiled.actions.map((action) => action.ref)).toEqual(['trigger', 'loop', 'finalize']);
  });
});
