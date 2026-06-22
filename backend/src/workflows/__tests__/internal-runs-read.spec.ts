import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import { InternalRunsController } from '../internal-runs.controller';
import type { WorkflowRunService } from '../workflow-run.service';
import type { NodeIOService } from '../../node-io/node-io.service';
import type { ArtifactsService } from '../../storage/artifacts.service';

describe('InternalRunsController read endpoints', () => {
  const workflowRunService = {
    getRun: mock(async () => ({
      id: 'run-1',
      workflowId: 'wf-1',
      status: 'COMPLETED',
    })),
    prepareRunPayload: mock(async () => ({})),
  } as unknown as WorkflowRunService;

  const nodeIOService = {
    listDetails: mock(async () => [
      {
        nodeRef: 'node-1',
        componentId: 'sentris.nuclei.scan',
        status: 'completed',
        outputs: { findings: [] },
      },
    ]),
  } as unknown as NodeIOService;

  const artifactsService = {
    listRunArtifacts: mock(async () => ({ runId: 'run-1', artifacts: [] })),
  } as unknown as ArtifactsService;

  let controller: InternalRunsController;

  beforeEach(() => {
    process.env.INTERNAL_SERVICE_TOKEN = 'test-internal-token';
    controller = new InternalRunsController(
      {
        get: (key: string) =>
          key === 'INTERNAL_SERVICE_TOKEN' ? 'test-internal-token' : undefined,
      } as ConfigService,
      workflowRunService,
      nodeIOService,
      artifactsService,
    );
  });

  it('rejects missing internal token', async () => {
    await expect(controller.getNodeIO(undefined, 'org-1', 'run-1')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('returns node-io for authorized internal requests', async () => {
    const result = await controller.getNodeIO('test-internal-token', 'org-1', 'run-1');
    expect(result.runId).toBe('run-1');
    expect(result.nodes).toHaveLength(1);
    expect(workflowRunService.getRun).toHaveBeenCalled();
  });

  it('lists artifacts for authorized internal requests', async () => {
    const result = await controller.listArtifacts('test-internal-token', 'org-1', 'run-1');
    expect(result.runId).toBe('run-1');
    expect(artifactsService.listRunArtifacts).toHaveBeenCalled();
  });
});
