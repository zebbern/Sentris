import { resolveInputValue } from '../input-resolver.js';
import {
  runWorkflowWithScheduler,
  type WorkflowSchedulerRunContext,
} from '../workflow-scheduler.js';
import type { LoopBodyDefinition, WorkflowDefinition } from '../types';

export type ExecuteWorkflowActionFn = (
  actionRef: string,
  definition: WorkflowDefinition,
  results: Map<string, unknown>,
  schedulerContext: WorkflowSchedulerRunContext,
) => Promise<{ activePorts?: string[] } | null>;

export interface ForEachLoopResult {
  results: unknown[];
  iterations: number;
  output: Record<string, unknown>;
}

function captureIterationResult(
  loopBody: LoopBodyDefinition,
  iterationResults: Map<string, unknown>,
): unknown {
  const sourceOutput = iterationResults.get(loopBody.iterationCapture.sourceRef);
  const captured = resolveInputValue(sourceOutput, loopBody.iterationCapture.sourceHandle);
  if (captured !== undefined) {
    return captured;
  }
  return sourceOutput ?? null;
}

export async function runForEachLoop(options: {
  forEachRef: string;
  items: unknown[];
  maxIterations?: number;
  loopBody: LoopBodyDefinition;
  parentResults: Map<string, unknown>;
  executeAction: ExecuteWorkflowActionFn;
  onNodeSkipped?: (actionRef: string) => Promise<void>;
}): Promise<ForEachLoopResult> {
  const cappedItems =
    typeof options.maxIterations === 'number' && options.maxIterations > 0
      ? options.items.slice(0, options.maxIterations)
      : options.items;

  const iterationOutputs: unknown[] = [];

  for (let index = 0; index < cappedItems.length; index += 1) {
    const currentItem = cappedItems[index];
    const iterationResults = new Map<string, unknown>(options.parentResults);
    iterationResults.set(options.forEachRef, {
      currentItem,
      body: currentItem,
      index,
      total: cappedItems.length,
    });

    await runWorkflowWithScheduler(options.loopBody.definition, {
      onNodeSkipped: options.onNodeSkipped,
      run: (actionRef, schedulerContext) =>
        options.executeAction(
          actionRef,
          options.loopBody.definition,
          iterationResults,
          schedulerContext,
        ),
    });

    iterationOutputs.push(captureIterationResult(options.loopBody, iterationResults));
  }

  const output = {
    currentItem: null,
    body: null,
    index: cappedItems.length,
    total: cappedItems.length,
    results: iterationOutputs,
    iterations: cappedItems.length,
  };

  return {
    results: iterationOutputs,
    iterations: cappedItems.length,
    output,
  };
}

export function getForEachLoopBody(
  definition: WorkflowDefinition,
  forEachRef: string,
): LoopBodyDefinition | undefined {
  return definition.loopBodies?.[forEachRef];
}
