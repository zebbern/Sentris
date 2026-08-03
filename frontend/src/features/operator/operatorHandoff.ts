import type { OperatorCreateTurn } from '@sentris/shared';

const OPERATOR_HANDOFF_VERSION = 1 as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface OperatorImproveRunHandoff {
  version: typeof OPERATOR_HANDOFF_VERSION;
  kind: 'improve_run';
  clientTurnId: string;
  sourceRunId: string;
  sourcePath: string;
}

export interface OperatorNavigationState {
  operatorHandoff: OperatorImproveRunHandoff;
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

export function readOperatorImproveRunHandoff(state: unknown): OperatorImproveRunHandoff | null {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return null;
  const handoff = (state as { operatorHandoff?: unknown }).operatorHandoff;
  if (!handoff || typeof handoff !== 'object' || Array.isArray(handoff)) return null;

  const candidate = handoff as Partial<OperatorImproveRunHandoff>;
  if (
    candidate.version !== OPERATOR_HANDOFF_VERSION ||
    candidate.kind !== 'improve_run' ||
    typeof candidate.clientTurnId !== 'string' ||
    !UUID_PATTERN.test(candidate.clientTurnId) ||
    typeof candidate.sourceRunId !== 'string' ||
    candidate.sourceRunId.trim().length === 0 ||
    typeof candidate.sourcePath !== 'string' ||
    !candidate.sourcePath.startsWith('/')
  ) {
    return null;
  }

  return candidate as OperatorImproveRunHandoff;
}

export function createOperatorTurnFromHandoff(
  handoff: OperatorImproveRunHandoff,
): OperatorCreateTurn {
  return {
    clientTurnId: handoff.clientTurnId,
    message: `Improve completed run ${handoff.sourceRunId}. Inspect its workflow and evidence, make a focused improvement, rerun it, and compare the result with the source run.`,
    context: { path: handoff.sourcePath },
    journey: { kind: 'improve_run', sourceRunId: handoff.sourceRunId },
  };
}
