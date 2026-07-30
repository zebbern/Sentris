import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, mock } from 'bun:test';

import type { ArtifactsService } from '../../storage/artifacts.service';
import type { NodeIOService } from '../../node-io/node-io.service';
import { InternalRunsController } from '../internal-runs.controller';
import { MarkRunStartedRequestSchema } from '../dto/run-started.dto';
import type { WorkflowRunService } from '../workflow-run.service';

describe('InternalRunsController started transition', () => {
  const markRunStarted = mock(async () => ({
    runId: 'run-1',
    workflowId: '00000000-0000-4000-8000-000000000001',
    temporalRunId: 'temporal-run-1',
    duplicate: false,
  }));
  const prepareRunPayload = mock(async () => ({
    runId: 'run-1',
    workflowId: '00000000-0000-4000-8000-000000000001',
    workflowVersionId: '00000000-0000-4000-8000-000000000002',
    workflowVersion: 1,
    organizationId: 'org-1',
    scopeId: null,
    definition: { actions: [] },
    inputs: {},
    triggerMetadata: {
      type: 'api' as const,
      sourceId: 'schedule-1',
      label: 'Scheduled run',
    },
    inputPreview: { runtimeInputs: {}, nodeOverrides: {} },
    totalActions: 0,
  }));
  const workflowRunService = {
    markRunStarted,
    prepareRunPayload,
  } as unknown as WorkflowRunService;

  let controller: InternalRunsController;

  beforeEach(() => {
    markRunStarted.mockClear();
    prepareRunPayload.mockClear();
    controller = new InternalRunsController(
      {
        get: (key: string) =>
          key === 'INTERNAL_SERVICE_TOKEN' ? 'test-internal-token' : undefined,
      } as ConfigService,
      workflowRunService,
      {} as NodeIOService,
      {} as ArtifactsService,
    );
  });

  it('records a started run using the explicitly authenticated organization', async () => {
    const response = await controller.markRunStarted('test-internal-token', 'org-1', 'run-1', {
      temporalRunId: 'temporal-run-1',
    });

    expect(markRunStarted).toHaveBeenCalledWith(
      'run-1',
      'temporal-run-1',
      expect.objectContaining({
        organizationId: 'org-1',
        provider: 'internal',
      }),
    );
    expect(response.duplicate).toBe(false);
  });

  it('rejects a started callback without internal credentials or an explicit tenant', async () => {
    await expect(
      controller.markRunStarted(undefined, 'org-1', 'run-1', {
        temporalRunId: 'temporal-run-1',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      controller.markRunStarted('test-internal-token', undefined, 'run-1', {
        temporalRunId: 'temporal-run-1',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(markRunStarted).not.toHaveBeenCalled();
  });

  it('propagates tenant-scoped not-found rejection', async () => {
    markRunStarted.mockRejectedValueOnce(new NotFoundException('Workflow run run-1 not found'));

    await expect(
      controller.markRunStarted('test-internal-token', 'foreign-org', 'run-1', {
        temporalRunId: 'temporal-run-1',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('requires the worker credential and explicit tenant for run preparation', async () => {
    const request = {
      workflowId: '00000000-0000-4000-8000-000000000001',
      runId: 'caller-selected-run',
      trigger: {
        type: 'api' as const,
        sourceId: 'caller-selected-source',
        label: 'Caller-selected trigger',
      },
    };

    await expect(controller.prepareRun(undefined, 'org-1', request)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(
      controller.prepareRun('test-internal-token', undefined, request),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(prepareRunPayload).not.toHaveBeenCalled();
  });

  it('prepares worker runs with internal auth rather than caller-supplied user auth', async () => {
    await controller.prepareRun('test-internal-token', 'org-1', {
      workflowId: '00000000-0000-4000-8000-000000000001',
      runId: 'worker-run-1',
      trigger: {
        type: 'schedule',
        sourceId: 'schedule-1',
        label: 'Scheduled run',
      },
    });

    expect(prepareRunPayload).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000001',
      expect.any(Object),
      expect.objectContaining({
        organizationId: 'org-1',
        provider: 'internal',
      }),
      expect.objectContaining({
        runId: 'worker-run-1',
        trigger: expect.objectContaining({ type: 'schedule' }),
      }),
    );
  });
});

describe('MarkRunStartedRequestSchema', () => {
  it('accepts a non-empty Temporal run id', () => {
    expect(MarkRunStartedRequestSchema.safeParse({ temporalRunId: 'temporal-run-1' }).success).toBe(
      true,
    );
  });

  it('rejects a missing or blank Temporal run id', () => {
    expect(MarkRunStartedRequestSchema.safeParse({}).success).toBe(false);
    expect(MarkRunStartedRequestSchema.safeParse({ temporalRunId: '   ' }).success).toBe(false);
  });
});
