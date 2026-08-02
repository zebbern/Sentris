import {
  OPERATOR_PERSISTED_TURN_PAYLOAD_VERSION,
  OperatorPersistedTurnPayloadSchema,
  OperatorRouteContextSchema,
  type OperatorDirectCommand,
  type OperatorPersistedTurnPayload,
  type OperatorRouteContext,
  type OperatorStoredTurnContext,
} from '@sentris/shared';

export function buildOperatorTurnPayload(input: {
  routeContext?: OperatorRouteContext;
  directCommand?: OperatorDirectCommand;
}): OperatorPersistedTurnPayload {
  return {
    version: OPERATOR_PERSISTED_TURN_PAYLOAD_VERSION,
    routeContext: input.routeContext ?? null,
    directCommand: input.directCommand ?? null,
  };
}

export function readOperatorTurnPayload(
  stored: OperatorStoredTurnContext,
): OperatorPersistedTurnPayload {
  const persisted = OperatorPersistedTurnPayloadSchema.safeParse(stored);
  if (persisted.success) return persisted.data;

  if (stored === null) return buildOperatorTurnPayload({});

  const legacyRoute = OperatorRouteContextSchema.safeParse(stored);
  if (legacyRoute.success) {
    return buildOperatorTurnPayload({ routeContext: legacyRoute.data });
  }

  throw new Error('Stored Operator turn payload is invalid');
}
