import {
  OPERATOR_PERSISTED_TURN_PAYLOAD_VERSION,
  OperatorDirectCommandSchema,
  OperatorPersistedTurnPayloadSchema,
  OperatorPersistedTurnPayloadV1Schema,
  OperatorRouteContextSchema,
  type OperatorDirectCommand,
  type OperatorJourney,
  type OperatorPersistedTurnPayload,
  type OperatorRouteContext,
  type OperatorStoredTurnContext,
} from '@sentris/shared';

export function buildOperatorTurnPayload(input: {
  routeContext?: OperatorRouteContext;
  directCommand?: OperatorDirectCommand;
  journey?: OperatorJourney;
}): OperatorPersistedTurnPayload {
  return {
    version: OPERATOR_PERSISTED_TURN_PAYLOAD_VERSION,
    routeContext: input.routeContext ?? null,
    directCommand: input.directCommand ?? null,
    journey: input.journey ?? null,
  };
}

export function readOperatorTurnPayload(
  stored: OperatorStoredTurnContext,
): OperatorPersistedTurnPayload {
  const persisted = OperatorPersistedTurnPayloadSchema.safeParse(stored);
  if (persisted.success) return persisted.data;

  const persistedV1 = OperatorPersistedTurnPayloadV1Schema.safeParse(stored);
  if (persistedV1.success) {
    const directCommand = persistedV1.data.directCommand;
    let normalizedDirectCommand: OperatorDirectCommand | undefined;
    if (
      directCommand?.commandName === 'promote_workflow_version' &&
      !('baseVersionId' in directCommand.arguments)
    ) {
      normalizedDirectCommand = {
        ...directCommand,
        arguments: {
          ...directCommand.arguments,
          // V1 predates the optimistic Keep fence. Using the candidate as the
          // expected base permits an idempotent replay only when it is already
          // current; otherwise promotion fails instead of overwriting newer work.
          baseVersionId: directCommand.arguments.versionId,
        },
      };
    } else if (directCommand) {
      normalizedDirectCommand = OperatorDirectCommandSchema.parse(directCommand);
    }
    return buildOperatorTurnPayload({
      routeContext: persistedV1.data.routeContext ?? undefined,
      journey: persistedV1.data.journey ?? undefined,
      directCommand: normalizedDirectCommand,
    });
  }

  if (stored === null) return buildOperatorTurnPayload({});

  const legacyRoute = OperatorRouteContextSchema.safeParse(stored);
  if (legacyRoute.success) {
    return buildOperatorTurnPayload({ routeContext: legacyRoute.data });
  }

  throw new Error('Stored Operator turn payload is invalid');
}
