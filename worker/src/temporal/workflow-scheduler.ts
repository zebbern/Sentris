import type { WorkflowDefinition, WorkflowJoinStrategy, WorkflowEdge } from './types';

export class WorkflowSchedulerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowSchedulerError';
  }
}

export interface SchedulerFailureDetails {
  message: string;
  name?: string;
}

export interface WorkflowSchedulerRunContext {
  joinStrategy: WorkflowJoinStrategy | 'all';
  triggeredBy?: string;
  failure?: {
    at: string;
    reason: SchedulerFailureDetails;
  };
}

export interface WorkflowSchedulerOptions {
  run: (
    actionRef: string,
    context: WorkflowSchedulerRunContext,
  ) => Promise<{ activePorts?: string[] } | null>;
  onNodeSkipped?: (actionRef: string) => Promise<void>;
}

interface NodeState {
  strategy: WorkflowJoinStrategy | 'all';
  successParents: Set<string>;
  skippedParents: Set<string>; // New: track skipped reasons
  failureParents: Set<string>;
  inactiveFailureParents: Set<string>;
  triggeredBySuccess: boolean;
  failureTriggered: boolean;
  errorTriggeredBy?: string;
  errorFailure?: WorkflowSchedulerRunContext['failure'];
  skipped: boolean; // New: track if node itself was skipped
  totalSuccessParents: number; // To facilitate 'any' strategy with skipping
}

interface ReadyItem {
  ref: string;
  context: WorkflowSchedulerRunContext;
}

export async function runWorkflowWithScheduler(
  definition: WorkflowDefinition,
  options: WorkflowSchedulerOptions,
): Promise<void> {
  const { run, onNodeSkipped } = options;

  // Map sourceRef -> List of Edges (preserving handle info)
  const successEdges = new Map<string, WorkflowEdge[]>();
  const failureDependents = new Map<string, string[]>();

  const successParentsMap = new Map<string, Set<string>>();
  const failureParentsMap = new Map<string, Set<string>>();

  for (const edge of definition.edges ?? []) {
    if (edge.kind === 'error') {
      const children = failureDependents.get(edge.sourceRef) ?? [];
      children.push(edge.targetRef);
      failureDependents.set(edge.sourceRef, children);

      const parents = failureParentsMap.get(edge.targetRef) ?? new Set<string>();
      parents.add(edge.sourceRef);
      failureParentsMap.set(edge.targetRef, parents);
    } else {
      const edges = successEdges.get(edge.sourceRef) ?? [];
      edges.push(edge);
      successEdges.set(edge.sourceRef, edges);

      const parents = successParentsMap.get(edge.targetRef) ?? new Set<string>();
      parents.add(edge.sourceRef);
      successParentsMap.set(edge.targetRef, parents);
    }
  }

  const nodeStates = new Map<string, NodeState>();
  const readyQueue: ReadyItem[] = [];
  const pending = new Set<string>();

  for (const action of definition.actions) {
    pending.add(action.ref);

    const successParents = new Set(successParentsMap.get(action.ref) ?? []);
    const failureParents = new Set(failureParentsMap.get(action.ref) ?? []);

    const metadata = definition.nodes?.[action.ref];
    const strategy: WorkflowJoinStrategy | 'all' = metadata?.joinStrategy ?? 'all';

    const state: NodeState = {
      strategy,
      successParents,
      skippedParents: new Set(),
      failureParents,
      inactiveFailureParents: new Set(),
      triggeredBySuccess: successParents.size === 0,
      failureTriggered: false,
      skipped: false,
      totalSuccessParents: successParents.size,
    };

    nodeStates.set(action.ref, state);

    if (successParents.size === 0 && failureParents.size === 0) {
      // Prioritize entrypoint to run first if it has no dependencies
      const isEntrypoint = action.ref === definition.entrypoint.ref;
      if (isEntrypoint) {
        readyQueue.unshift({ ref: action.ref, context: { joinStrategy: strategy } });
      } else {
        readyQueue.push({ ref: action.ref, context: { joinStrategy: strategy } });
      }
    }
  }

  const failedErrors = new Map<string, unknown>();
  const handledFailureSources = new Map<string, Set<string>>();

  while (pending.size > 0) {
    if (readyQueue.length === 0) {
      // Check if all pending nodes are skipped or waiting on dead paths
      // Actually, deadlock detection here is correct
      // If pending > 0 and queue is empty, and we haven't failed, it's a deadlock or partial skip that didn't propagate?
      // With proper propagation, skipped nodes are removed from pending.
      // So if pending > 0, it means we are waiting for something.

      throw new WorkflowSchedulerError(
        'Workflow scheduler deadlock: no ready actions while workflow still incomplete',
      );
    }

    // Sort ready queue to ensure entrypoint runs first if present
    readyQueue.sort((a, b) => {
      const aIsEntrypoint = a.ref === definition.entrypoint.ref;
      const bIsEntrypoint = b.ref === definition.entrypoint.ref;
      if (aIsEntrypoint && !bIsEntrypoint) return -1;
      if (!aIsEntrypoint && bIsEntrypoint) return 1;
      return 0;
    });

    const batch = readyQueue.splice(0);
    const executions: { ref: string; context: WorkflowSchedulerRunContext }[] = [];

    for (const item of batch) {
      if (!pending.has(item.ref)) {
        continue;
      }
      pending.delete(item.ref); // Node is now "running" or about to run
      executions.push(item);
    }

    if (executions.length === 0) {
      continue;
    }

    const settled = await Promise.all(
      executions.map(({ ref, context }) =>
        run(ref, context)
          .then((result) => ({
            ref,
            context,
            result,
            status: 'fulfilled' as const,
            completedAt: Date.now(),
          }))
          .catch((reason: unknown) => ({
            ref,
            context,
            status: 'rejected' as const,
            reason,
            completedAt: Date.now(),
          })),
      ),
    );

    settled.sort((a, b) => a.completedAt - b.completedAt);

    for (const outcome of settled) {
      const { ref, context } = outcome;

      if (outcome.status === 'fulfilled') {
        const handledSources = handledFailureSources.get(ref);
        if (handledSources) {
          for (const source of handledSources) {
            failedErrors.delete(source);
          }
          handledFailureSources.delete(ref);
        }

        const activePorts = outcome.result?.activePorts;
        await handleSuccess(
          ref,
          activePorts,
          readyQueue,
          pending,
          nodeStates,
          successEdges,
          failureDependents,
          onNodeSkipped,
        );
      } else {
        failedErrors.set(ref, outcome.reason);
        await handleFailure(
          ref,
          context.triggeredBy ?? ref,
          readyQueue,
          pending,
          nodeStates,
          successEdges,
          failureDependents,
          failedErrors,
          handledFailureSources,
          onNodeSkipped,
        );
      }
    }
  }

  if (failedErrors.size > 0) {
    const aggregate = new WorkflowSchedulerError('One or more workflow actions failed');
    (aggregate as any).causes = failedErrors;
    throw aggregate;
  }
}

async function handleSuccess(
  ref: string,
  activePorts: string[] | undefined,
  readyQueue: ReadyItem[],
  pending: Set<string>,
  nodeStates: Map<string, NodeState>,
  successEdges: Map<string, WorkflowEdge[]>,
  failureDependents: Map<string, string[]>,
  onNodeSkipped?: (ref: string) => Promise<void>,
) {
  const edges = successEdges.get(ref) ?? [];

  const triggeredChildren = new Set<string>();
  const skippedChildren = new Set<string>();

  for (const edge of edges) {
    let isActive = true;
    if (activePorts) {
      const port = edge.sourceHandle ?? 'default';
      isActive = activePorts.includes(port);
    }

    if (isActive) {
      triggeredChildren.add(edge.targetRef);
    } else {
      skippedChildren.add(edge.targetRef);
    }
  }

  // Refine sets: if ANY edge to a child is active, the child is triggered.
  // Only if ALL edges to the child are inactive (from this parent) do we consider it skipped from this parent's perspective.
  // Actually, we process edges. If Ref A -> Ref B via "Default" (active) AND via "Error" (inactive),
  // Ref B is triggered.

  const finalTriggered = new Set(triggeredChildren);
  const finalSkipped = new Set<string>();

  for (const child of skippedChildren) {
    if (!finalTriggered.has(child)) {
      finalSkipped.add(child);
    }
  }

  for (const child of finalTriggered) {
    await processChild(
      child,
      ref,
      'fulfilled',
      readyQueue,
      pending,
      nodeStates,
      successEdges,
      failureDependents,
      onNodeSkipped,
    );
  }

  for (const child of finalSkipped) {
    await processChild(
      child,
      ref,
      'skipped',
      readyQueue,
      pending,
      nodeStates,
      successEdges,
      failureDependents,
      onNodeSkipped,
    );
  }

  await markInactiveFailureDependents(
    ref,
    readyQueue,
    pending,
    nodeStates,
    successEdges,
    failureDependents,
    onNodeSkipped,
  );
}

async function processChild(
  childRef: string,
  parentRef: string,
  type: 'fulfilled' | 'skipped',
  readyQueue: ReadyItem[],
  pending: Set<string>,
  nodeStates: Map<string, NodeState>,
  successEdges: Map<string, WorkflowEdge[]>,
  failureDependents: Map<string, string[]>,
  onNodeSkipped?: (ref: string) => Promise<void>,
) {
  if (!pending.has(childRef)) return;

  const state = nodeStates.get(childRef);
  if (!state || state.failureTriggered || state.skipped) return;

  if (state.successParents.has(parentRef)) {
    state.successParents.delete(parentRef);

    if (type === 'skipped') {
      state.skippedParents.add(parentRef);
    }
  } else {
    // Already processed this parent
    return;
  }

  if (state.strategy === 'all') {
    if (state.successParents.size === 0) {
      if (state.skippedParents.size > 0) {
        // If 'all' strategy and at least one parent skipped, we skip.
        await handleSkip(
          childRef,
          readyQueue,
          pending,
          nodeStates,
          successEdges,
          failureDependents,
          onNodeSkipped,
        );
      } else if (!state.triggeredBySuccess) {
        state.triggeredBySuccess = true;
        queueReadyIfSatisfiedByFailureState(childRef, parentRef, state, readyQueue);
      }
    }
  } else {
    // ANY / FIRST
    if (type === 'fulfilled' && !state.triggeredBySuccess) {
      state.triggeredBySuccess = true;
      queueReadyIfSatisfiedByFailureState(childRef, parentRef, state, readyQueue);
    } else if (state.successParents.size === 0) {
      // All parents finished.
      // If we haven't been triggered yet, it means everything skipped.
      if (!state.triggeredBySuccess) {
        await handleSkip(
          childRef,
          readyQueue,
          pending,
          nodeStates,
          successEdges,
          failureDependents,
          onNodeSkipped,
        );
      }
    }
  }
}

function queueReadyIfSatisfiedByFailureState(
  childRef: string,
  successParentRef: string,
  state: NodeState,
  readyQueue: ReadyItem[],
) {
  if (state.failureParents.size > 0) {
    if (!state.errorTriggeredBy) {
      return;
    }

    readyQueue.push({
      ref: childRef,
      context: {
        joinStrategy: state.strategy,
        triggeredBy: state.errorTriggeredBy,
        failure: state.errorFailure,
      },
    });
    return;
  }

  readyQueue.push({
    ref: childRef,
    context: {
      joinStrategy: state.strategy,
      triggeredBy: state.strategy === 'all' ? undefined : successParentRef,
    },
  });
}

async function handleSkip(
  ref: string,
  readyQueue: ReadyItem[],
  pending: Set<string>,
  nodeStates: Map<string, NodeState>,
  successEdges: Map<string, WorkflowEdge[]>,
  failureDependents: Map<string, string[]>,
  onNodeSkipped?: (ref: string) => Promise<void>,
) {
  if (!pending.has(ref)) return;

  pending.delete(ref);
  const state = nodeStates.get(ref);
  if (state) state.skipped = true;

  if (onNodeSkipped) {
    await onNodeSkipped(ref);
  }

  await markInactiveFailureDependents(
    ref,
    readyQueue,
    pending,
    nodeStates,
    successEdges,
    failureDependents,
    onNodeSkipped,
  );

  const edges = successEdges.get(ref) ?? [];
  const children = new Set(edges.map((e) => e.targetRef));

  for (const child of children) {
    await processChild(
      child,
      ref,
      'skipped',
      readyQueue,
      pending,
      nodeStates,
      successEdges,
      failureDependents,
      onNodeSkipped,
    );
  }
}

async function markInactiveFailureDependents(
  ref: string,
  readyQueue: ReadyItem[],
  pending: Set<string>,
  nodeStates: Map<string, NodeState>,
  successEdges: Map<string, WorkflowEdge[]>,
  failureDependents: Map<string, string[]>,
  onNodeSkipped?: (ref: string) => Promise<void>,
) {
  const children = failureDependents.get(ref) ?? [];
  for (const child of children) {
    const childState = nodeStates.get(child);
    if (
      !childState ||
      !pending.has(child) ||
      childState.errorTriggeredBy ||
      childState.failureTriggered ||
      childState.skipped
    ) {
      continue;
    }

    childState.inactiveFailureParents.add(ref);
    if (childState.inactiveFailureParents.size === childState.failureParents.size) {
      await handleSkip(
        child,
        readyQueue,
        pending,
        nodeStates,
        successEdges,
        failureDependents,
        onNodeSkipped,
      );
    }
  }
}

async function handleFailure(
  ref: string,
  triggerSource: string,
  readyQueue: ReadyItem[],
  pending: Set<string>,
  nodeStates: Map<string, NodeState>,
  successEdges: Map<string, WorkflowEdge[]>,
  failureDependents: Map<string, string[]>,
  failedErrors: Map<string, unknown>,
  handledFailureSources: Map<string, Set<string>>,
  onNodeSkipped?: (ref: string) => Promise<void>,
) {
  const queue: { ref: string; source: string }[] = [{ ref, source: triggerSource }];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const { ref: current, source: _source } = queue.shift()!;
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);

    const state = nodeStates.get(current);
    if (state) {
      state.failureTriggered = true;
    }

    // Schedule failure dependents (error edges)
    const failureChildren = failureDependents.get(current) ?? [];
    const failureReason = normalizeFailureReason(failedErrors.get(current));
    const failure = failureReason
      ? {
          at: current,
          reason: failureReason,
        }
      : undefined;
    const hasFailureHandler = failureChildren.length > 0;
    for (const child of failureChildren) {
      const childState = nodeStates.get(child);
      if (!childState || childState.failureTriggered) {
        continue;
      }
      childState.errorTriggeredBy = current;
      childState.errorFailure = failure;
      const handledSources = handledFailureSources.get(child) ?? new Set<string>();
      handledSources.add(current);
      handledFailureSources.set(child, handledSources);

      if (childState.successParents.size === 0 && !childState.skipped) {
        readyQueue.push({
          ref: child,
          context: {
            joinStrategy: childState.strategy,
            triggeredBy: current,
            failure,
          },
        });
      }
    }

    // Cancel success dependents and propagate failure downstream
    // Reuse successEdges to find children
    const edges = successEdges.get(current) ?? [];
    // Distinct children
    const children = new Set(edges.map((e) => e.targetRef));

    for (const child of children) {
      const childState = nodeStates.get(child);
      if (!childState || childState.failureTriggered) {
        continue;
      }

      if (!childState.successParents.has(current)) {
        continue;
      }

      if (!pending.has(child)) {
        continue;
      }

      if (hasFailureHandler) {
        await processChild(
          child,
          current,
          'skipped',
          readyQueue,
          pending,
          nodeStates,
          successEdges,
          failureDependents,
          onNodeSkipped,
        );
        continue;
      }

      childState.successParents.delete(current);
      const remainingParents = childState.successParents.size;
      const shouldCancel =
        childState.strategy === 'all' || (remainingParents === 0 && !childState.triggeredBySuccess);

      if (!shouldCancel) {
        continue;
      }

      pending.delete(child);
      childState.failureTriggered = true;
      failedErrors.set(
        child,
        new WorkflowSchedulerError(`Cancelled due to upstream failure at ${current}`),
      );
      queue.push({ ref: child, source: current });
    }
  }
}

function normalizeFailureReason(reason: unknown): SchedulerFailureDetails | undefined {
  if (reason instanceof Error) {
    const causeReason = normalizeFailureCause(reason);
    if (causeReason && isGenericFailureWrapper(reason)) {
      return causeReason;
    }

    return {
      message: reason.message,
      name: reason.name && reason.name !== 'Error' ? reason.name : undefined,
    };
  }

  if (reason === undefined || reason === null) {
    return { message: 'Unknown failure' };
  }

  if (typeof reason === 'string') {
    return { message: reason };
  }

  if (typeof reason === 'object') {
    try {
      return { message: JSON.stringify(reason) };
    } catch {
      return { message: String(reason) };
    }
  }

  return { message: String(reason) };
}

function normalizeFailureCause(reason: Error): SchedulerFailureDetails | undefined {
  const cause = (reason as Error & { cause?: unknown }).cause;
  if (cause === undefined || cause === null || cause === reason) {
    return undefined;
  }
  return normalizeFailureReason(cause);
}

function isGenericFailureWrapper(reason: Error): boolean {
  const name = reason.name.toLowerCase();
  const message = reason.message.toLowerCase();
  return (
    name === 'activityfailure' ||
    name === 'workflowfailure' ||
    name === 'applicationfailure' ||
    message === 'activity task failed' ||
    message === 'workflow task failed'
  );
}
