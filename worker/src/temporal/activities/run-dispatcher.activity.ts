import type { PreparedRunPayload } from '@sentris/shared';
import { ConfigurationError, ServiceError } from '@sentris/component-sdk';

import type {
  MarkRunStartedActivityInput,
  MarkRunStartedActivityOutput,
  PrepareRunPayloadActivityInput,
} from '../types';
import { buildBackendApiUrl } from '../../common/backend-url';

type FetchResponse = Awaited<ReturnType<typeof fetch>>;

async function readErrorBody(response: FetchResponse): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '<unable to read response body>';
  }
}

export async function prepareRunPayloadActivity(
  input: PrepareRunPayloadActivityInput,
): Promise<PreparedRunPayload> {
  const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
  if (!internalToken) {
    throw new ConfigurationError(
      'INTERNAL_SERVICE_TOKEN env var must be set to call internal run endpoint',
      {
        configKey: 'INTERNAL_SERVICE_TOKEN',
      },
    );
  }

  const organizationId = input.organizationId ?? process.env.DEFAULT_ORGANIZATION_ID ?? null;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Internal-Token': internalToken,
  };

  if (organizationId) {
    headers['X-Organization-Id'] = organizationId;
  }

  const response = await fetch(buildBackendApiUrl('internal/runs'), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      workflowId: input.workflowId,
      inputs: input.inputs,
      versionId: input.versionId,
      version: input.version,
      nodeOverrides: input.nodeOverrides,
      trigger: input.trigger,
      runId: input.runId,
      scopeId: input.scopeId,
      parentRunId: input.parentRunId,
      parentNodeRef: input.parentNodeRef,
    }),
  });

  if (!response.ok) {
    const raw = await readErrorBody(response);
    throw new ServiceError(`Failed to prepare run payload: ${raw}`, {
      statusCode: response.status,
      details: { statusText: response.statusText, workflowId: input.workflowId },
    });
  }

  return (await response.json()) as PreparedRunPayload;
}

export async function markRunStartedActivity(
  input: MarkRunStartedActivityInput,
): Promise<MarkRunStartedActivityOutput> {
  const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
  if (!internalToken) {
    throw new ConfigurationError(
      'INTERNAL_SERVICE_TOKEN env var must be set to call internal run endpoint',
      {
        configKey: 'INTERNAL_SERVICE_TOKEN',
      },
    );
  }

  const organizationId = input.organizationId?.trim();
  if (!organizationId) {
    throw new ConfigurationError(
      'organizationId is required to persist a worker-started workflow run',
      {
        configKey: 'organizationId',
      },
    );
  }

  const response = await fetch(
    buildBackendApiUrl(`internal/runs/${encodeURIComponent(input.runId)}/started`),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Token': internalToken,
        'X-Organization-Id': organizationId,
      },
      body: JSON.stringify({ temporalRunId: input.temporalRunId }),
    },
  );

  if (!response.ok) {
    const raw = await readErrorBody(response);
    throw new ServiceError(`Failed to persist started workflow run: ${raw}`, {
      statusCode: response.status,
      details: {
        statusText: response.statusText,
        runId: input.runId,
        temporalRunId: input.temporalRunId,
      },
    });
  }

  return (await response.json()) as MarkRunStartedActivityOutput;
}
