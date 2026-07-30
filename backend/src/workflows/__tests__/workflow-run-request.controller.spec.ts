import { describe, expect, it, vi } from 'bun:test';

import type { AuthContext } from '../../auth/types';
import { WorkflowsController } from '../workflows.controller';

describe('WorkflowsController workflow run request', () => {
  it('routes the public run endpoint through the durable audited service path', async () => {
    const auth: AuthContext = {
      userId: 'user-1',
      organizationId: 'org-1',
      roles: ['ADMIN'],
      isAuthenticated: true,
      provider: 'test',
    };
    const handle = {
      runId: 'sentris-run-1',
      workflowId: 'workflow-1',
      workflowVersionId: 'version-1',
      workflowVersion: 1,
      temporalRunId: 'temporal-run-1',
      status: 'RUNNING' as const,
      taskQueue: 'sentris-default',
    };
    const workflowsService = {
      run: vi.fn().mockResolvedValue(handle),
      prepareRunPayload: vi.fn(),
      startPreparedRun: vi.fn(),
    };
    const controller = new WorkflowsController(
      workflowsService as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await controller.run(
      auth,
      'workflow-1',
      {
        inputs: {},
        scopeId: '11111111-1111-4111-8111-111111111111',
      },
      { 'idempotency-key': 'caller-request-1' },
    );

    expect(result).toEqual(handle);
    expect(workflowsService.run).toHaveBeenCalledWith(
      'workflow-1',
      {
        inputs: {},
        versionId: undefined,
        version: undefined,
        scopeId: '11111111-1111-4111-8111-111111111111',
      },
      auth,
      { idempotencyKey: 'caller-request-1' },
    );
    expect(workflowsService.prepareRunPayload).not.toHaveBeenCalled();
    expect(workflowsService.startPreparedRun).not.toHaveBeenCalled();
  });
});
