import {
  OperatorDirectCommandSchema,
  type OperatorCreateTurn,
  type OperatorDirectCommand,
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
}

export type OperatorTurnHandoff = OperatorImproveRunHandoff | OperatorDirectCommandHandoff;

export interface OperatorNavigationState {
  operatorHandoff: OperatorTurnHandoff;
}

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
    if (
      typeof directCandidate.message === 'string' &&
      directCandidate.message.trim().length > 0 &&
      directCandidate.message.length <= 20_000 &&
      directCommand.success
    ) {
      return {
        ...(directCandidate as OperatorDirectCommandHandoff),
        directCommand: directCommand.data,
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
      context: { path: handoff.sourcePath },
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
