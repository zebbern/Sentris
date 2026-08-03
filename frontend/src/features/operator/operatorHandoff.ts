import {
  OperatorDirectCommandSchema,
  OperatorRouteContextSchema,
  type OperatorCreateTurn,
  type OperatorDirectCommand,
  type OperatorRouteContext,
} from '@sentris/shared';

const OPERATOR_HANDOFF_VERSION = 1 as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface OperatorImproveRunHandoff {
  version: typeof OPERATOR_HANDOFF_VERSION;
  kind: 'improve_run';
  clientTurnId: string;
  sourceRunId: string;
  sourcePath: string;
}

export interface OperatorDirectCommandHandoff {
  version: typeof OPERATOR_HANDOFF_VERSION;
  kind: 'direct_command';
  clientTurnId: string;
  message: string;
  directCommand: OperatorDirectCommand;
  sourcePath: string;
  routeContext?: OperatorRouteContext;
}

export type OperatorTurnHandoff = OperatorImproveRunHandoff | OperatorDirectCommandHandoff;

export interface OperatorNavigationState {
  operatorHandoff: OperatorTurnHandoff;
}

interface OperatorInvestigateRunInput {
  runId: string;
  workflowId: string;
  sourcePath: string;
}

interface OperatorInvestigateFindingInput {
  findingId: string;
  workflowId?: string;
  runId?: string;
  sourcePath: string;
}

const INVESTIGATE_RUN_MESSAGE =
  'Investigate this run. Review its status, stored output, recent and failed trace evidence, and findings. Explain what happened and recommend the most useful next step. Do not make changes unless I ask.';
const INVESTIGATE_FINDING_MESSAGE =
  'Investigate this finding. Review its bounded raw evidence, source run and workflow context, and current triage state. Explain what it means, how credible it is, and recommend the most useful next step. Do not change triage or workflows unless I ask.';

export function createOperatorImproveRunNavigationState(
  sourceRunId: string,
  sourcePath: string,
  createId: () => string = () => crypto.randomUUID(),
): OperatorNavigationState {
  return {
    operatorHandoff: {
      version: OPERATOR_HANDOFF_VERSION,
      kind: 'improve_run',
      clientTurnId: createId(),
      sourceRunId,
      sourcePath,
    },
  };
}

export function createOperatorDirectCommandNavigationState(
  message: string,
  directCommand: OperatorDirectCommand,
  sourcePath: string,
  createId: () => string = () => crypto.randomUUID(),
): OperatorNavigationState {
  return {
    operatorHandoff: {
      version: OPERATOR_HANDOFF_VERSION,
      kind: 'direct_command',
      clientTurnId: createId(),
      message,
      directCommand,
      sourcePath,
    },
  };
}

export function createOperatorInvestigateRunNavigationState(
  input: OperatorInvestigateRunInput,
  createId: () => string = () => crypto.randomUUID(),
): OperatorNavigationState {
  return {
    operatorHandoff: {
      version: OPERATOR_HANDOFF_VERSION,
      kind: 'direct_command',
      clientTurnId: createId(),
      message: INVESTIGATE_RUN_MESSAGE,
      directCommand: { commandName: 'get_run', arguments: { runId: input.runId } },
      sourcePath: input.sourcePath,
      routeContext: {
        path: input.sourcePath,
        workflowId: input.workflowId,
        runId: input.runId,
      },
    },
  };
}

export function createOperatorInvestigateFindingNavigationState(
  input: OperatorInvestigateFindingInput,
  createId: () => string = () => crypto.randomUUID(),
): OperatorNavigationState {
  return {
    operatorHandoff: {
      version: OPERATOR_HANDOFF_VERSION,
      kind: 'direct_command',
      clientTurnId: createId(),
      message: INVESTIGATE_FINDING_MESSAGE,
      directCommand: { commandName: 'get_finding', arguments: { findingId: input.findingId } },
      sourcePath: input.sourcePath,
      routeContext: {
        path: input.sourcePath,
        ...(input.workflowId ? { workflowId: input.workflowId } : {}),
        ...(input.runId ? { runId: input.runId } : {}),
      },
    },
  };
}

export function readOperatorTurnHandoff(state: unknown): OperatorTurnHandoff | null {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return null;
  const handoff = (state as { operatorHandoff?: unknown }).operatorHandoff;
  if (!handoff || typeof handoff !== 'object' || Array.isArray(handoff)) return null;

  const candidate = handoff as Partial<OperatorTurnHandoff>;
  if (
    candidate.version !== OPERATOR_HANDOFF_VERSION ||
    typeof candidate.clientTurnId !== 'string' ||
    !UUID_PATTERN.test(candidate.clientTurnId) ||
    typeof candidate.sourcePath !== 'string' ||
    !candidate.sourcePath.startsWith('/')
  ) {
    return null;
  }

  if (
    candidate.kind === 'improve_run' &&
    typeof candidate.sourceRunId === 'string' &&
    candidate.sourceRunId.trim().length > 0
  ) {
    return candidate as OperatorImproveRunHandoff;
  }

  if (candidate.kind === 'direct_command') {
    const directCandidate = candidate as Partial<OperatorDirectCommandHandoff>;
    const directCommand = OperatorDirectCommandSchema.safeParse(directCandidate.directCommand);
    const routeContext =
      directCandidate.routeContext === undefined
        ? undefined
        : OperatorRouteContextSchema.safeParse(directCandidate.routeContext);
    if (
      typeof directCandidate.message === 'string' &&
      directCandidate.message.trim().length > 0 &&
      directCandidate.message.length <= 20_000 &&
      directCommand.success &&
      (routeContext === undefined || routeContext.success)
    ) {
      return {
        ...(directCandidate as OperatorDirectCommandHandoff),
        directCommand: directCommand.data,
        ...(routeContext ? { routeContext: routeContext.data } : {}),
      };
    }
  }

  return null;
}

export function readOperatorImproveRunHandoff(state: unknown): OperatorImproveRunHandoff | null {
  const handoff = readOperatorTurnHandoff(state);
  return handoff?.kind === 'improve_run' ? handoff : null;
}

export function createOperatorTurnFromHandoff(handoff: OperatorTurnHandoff): OperatorCreateTurn {
  if (handoff.kind === 'direct_command') {
    return {
      clientTurnId: handoff.clientTurnId,
      message: handoff.message,
      context: handoff.routeContext ?? { path: handoff.sourcePath },
      directCommand: handoff.directCommand,
    };
  }

  return {
    clientTurnId: handoff.clientTurnId,
    message: `Improve completed run ${handoff.sourceRunId}. Inspect its workflow and evidence, make a focused improvement, rerun it, and compare the result with the source run.`,
    context: { path: handoff.sourcePath },
    journey: { kind: 'improve_run', sourceRunId: handoff.sourceRunId },
  };
}
