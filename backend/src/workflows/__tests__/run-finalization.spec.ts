import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, mock } from 'bun:test';

import type { ArtifactsService } from '../../storage/artifacts.service';
import type { NodeIOService } from '../../node-io/node-io.service';
import { InternalRunsController } from '../internal-runs.controller';
import { FinalizeRunRequestSchema } from '../dto/run-finalization.dto';
import type { WorkflowRunService } from '../workflow-run.service';

describe('InternalRunsController run finalization', () => {
  const finalizeRun = mock(async () => ({
    runId: 'run-1',
    status: 'COMPLETED',
    duplicate: false,
  }));
  const workflowRunService = {
    finalizeRun,
    prepareRunPayload: mock(async () => ({})),
  } as unknown as WorkflowRunService;

  let controller: InternalRunsController;

  beforeEach(() => {
    finalizeRun.mockClear();
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

  it('finalizes a terminal run using the authenticated organization header', async () => {
    const response = await controller.finalizeRun('test-internal-token', 'org-1', 'run-1', {
      status: 'COMPLETED',
      completedAt: '2026-07-26T12:00:00.000Z',
    });

    expect(finalizeRun).toHaveBeenCalledWith(
      'run-1',
      {
        status: 'COMPLETED',
        completedAt: '2026-07-26T12:00:00.000Z',
      },
      expect.objectContaining({ organizationId: 'org-1', provider: 'internal' }),
    );
    expect(response.status).toBe('COMPLETED');
  });

  it('rejects a finalization callback without internal credentials', async () => {
    await expect(
      controller.finalizeRun(undefined, 'org-1', 'run-1', { status: 'FAILED' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(finalizeRun).not.toHaveBeenCalled();
  });

  it('propagates tenant-scoped not-found rejection', async () => {
    finalizeRun.mockRejectedValueOnce(new NotFoundException('Workflow run run-1 not found'));

    await expect(
      controller.finalizeRun('test-internal-token', 'foreign-org', 'run-1', {
        status: 'FAILED',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('FinalizeRunRequestSchema', () => {
  it('accepts all reportable terminal statuses', () => {
    for (const status of ['COMPLETED', 'FAILED', 'CANCELLED', 'TERMINATED', 'TIMED_OUT']) {
      expect(FinalizeRunRequestSchema.safeParse({ status }).success).toBe(true);
    }
  });

  it('rejects running and stale statuses', () => {
    expect(FinalizeRunRequestSchema.safeParse({ status: 'RUNNING' }).success).toBe(false);
    expect(FinalizeRunRequestSchema.safeParse({ status: 'STALE' }).success).toBe(false);
  });
});
