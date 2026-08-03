import { ConflictException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'bun:test';

import '@sentris/worker/components';

import type { AuthContext } from '../../auth/types';
import { WorkflowGraphSchema } from '../dto/workflow-graph.dto';
import { WorkflowsService } from '../workflows.service';

const ORGANIZATION_ID = 'org-1';
const AUTH: AuthContext = {
  userId: 'admin-1',
  organizationId: ORGANIZATION_ID,
  roles: ['ADMIN'],
  provider: 'test',
  isAuthenticated: true,
};

const GRAPH = WorkflowGraphSchema.parse({
  name: 'Operator-authored workflow',
  description: 'Initial draft',
  nodes: [
    {
      id: 'trigger',
      type: 'core.workflow.entrypoint',
      position: { x: 0, y: 0 },
      data: {
        label: 'Trigger',
        config: { params: { runtimeInputs: [] }, inputOverrides: {} },
      },
    },
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
});

type Graph = typeof GRAPH;

interface StoredWorkflow {
  id: string;
  name: string;
  description: string | null;
  graph: Graph;
  compiledDefinition: null;
  organizationId: string;
  currentVersionId: string | null;
  mutationIdempotencyKey: string | null;
  lastRun: null;
  runCount: number;
  createdAt: Date;
  updatedAt: Date;
}

interface StoredVersion {
  id: string;
  workflowId: string;
  version: number;
  graph: Graph;
  compiledDefinition: null;
  organizationId: string;
  mutationIdempotencyKey: string | null;
  createdAt: Date;
}

function createHarness() {
  const now = new Date('2026-08-02T12:00:00.000Z');
  let workflow: StoredWorkflow | undefined;
  const versions: StoredVersion[] = [];
  const executor = { id: 'workflow-mutation-transaction' };

  const repository = {
    transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(executor)),
    findByMutationIdempotencyKey: vi.fn(
      async (key: string, options: { organizationId?: string | null }) =>
        workflow?.mutationIdempotencyKey === key &&
        (!options.organizationId || workflow.organizationId === options.organizationId)
          ? workflow
          : undefined,
    ),
    create: vi.fn(
      async (
        input: Graph,
        options: { organizationId: string; mutationIdempotencyKey?: string },
      ) => {
        workflow = {
          id: 'workflow-1',
          name: input.name,
          description: input.description ?? null,
          graph: input,
          compiledDefinition: null,
          organizationId: options.organizationId,
          currentVersionId: null,
          mutationIdempotencyKey: options.mutationIdempotencyKey ?? null,
          lastRun: null,
          runCount: 0,
          createdAt: now,
          updatedAt: now,
        };
        return workflow;
      },
    ),
    findByIdForUpdate: vi.fn(async (_id: string, options: { organizationId?: string | null }) =>
      workflow && (!options.organizationId || workflow.organizationId === options.organizationId)
        ? workflow
        : undefined,
    ),
    update: vi.fn(async (_id: string, input: Graph) => {
      if (!workflow) throw new Error('Workflow not found');
      workflow = {
        ...workflow,
        name: input.name,
        description: input.description ?? null,
        graph: input,
        updatedAt: new Date(now.getTime() + versions.length * 1_000),
      };
      return workflow;
    }),
    activateVersion: vi.fn(async (_id: string, version: StoredVersion) => {
      if (!workflow) throw new Error('Workflow not found');
      workflow = {
        ...workflow,
        name: version.graph.name,
        description: version.graph.description ?? null,
        graph: version.graph,
        compiledDefinition: version.compiledDefinition,
        currentVersionId: version.id,
        updatedAt: new Date(now.getTime() + versions.length * 1_000),
      };
      return workflow;
    }),
  };

  const versionRepository = {
    findByMutationIdempotencyKey: vi.fn(
      async (key: string, options: { organizationId?: string | null }) =>
        versions.find(
          (version) =>
            version.mutationIdempotencyKey === key &&
            (!options.organizationId || version.organizationId === options.organizationId),
        ),
    ),
    create: vi.fn(
      async (input: {
        workflowId: string;
        graph: Graph;
        organizationId: string;
        mutationIdempotencyKey?: string;
      }) => {
        const version: StoredVersion = {
          id: `version-${versions.length + 1}`,
          workflowId: input.workflowId,
          version: versions.length + 1,
          graph: input.graph,
          compiledDefinition: null,
          organizationId: input.organizationId,
          mutationIdempotencyKey: input.mutationIdempotencyKey ?? null,
          createdAt: new Date(now.getTime() + versions.length * 1_000),
        };
        versions.push(version);
        return version;
      },
    ),
    findLatestByWorkflowId: vi.fn(async (workflowId: string) =>
      versions.filter((version) => version.workflowId === workflowId).at(-1),
    ),
  };

  const roleRepository = {
    upsert: vi.fn(async () => undefined),
    hasRole: vi.fn(async () => false),
  };
  const auditLogService = {
    recordDurableWithExecutor: vi.fn(async () => undefined),
  };
  const service = new WorkflowsService(
    repository as never,
    roleRepository as never,
    versionRepository as never,
    {} as never,
    {} as never,
    auditLogService as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  return {
    service,
    repository,
    versionRepository,
    roleRepository,
    auditLogService,
    getWorkflow: () => workflow,
    getVersions: () => [...versions],
  };
}

describe('workflow mutation idempotency and optimistic concurrency', () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    harness = createHarness();
  });

  it('replays a create mutation without duplicating workflow, version, role, or audit writes', async () => {
    const first = await harness.service.create(GRAPH, AUTH, {
      idempotencyKey: 'operator-action:create-1',
    });
    const replay = await harness.service.create(GRAPH, AUTH, {
      idempotencyKey: 'operator-action:create-1',
    });

    expect(replay).toEqual(first);
    expect(replay.currentVersionId).toBe('version-1');
    expect(replay.currentVersion).toBe(1);
    expect(harness.repository.create).toHaveBeenCalledTimes(1);
    expect(harness.versionRepository.create).toHaveBeenCalledTimes(1);
    expect(harness.roleRepository.upsert).toHaveBeenCalledTimes(1);
    expect(harness.auditLogService.recordDurableWithExecutor).toHaveBeenCalledTimes(1);
  });

  it('replays the exact saved update version even after a newer version exists', async () => {
    const created = await harness.service.create(GRAPH, AUTH);
    const authoredGraph = { ...GRAPH, description: 'Operator-authored revision' };
    const authored = await harness.service.update('workflow-1', authoredGraph, AUTH, {
      idempotencyKey: 'operator-action:update-1',
      expectedVersionId: created.currentVersionId ?? undefined,
    });
    await harness.service.update(
      'workflow-1',
      { ...GRAPH, description: 'Later human revision' },
      AUTH,
      { expectedVersionId: authored.currentVersionId ?? undefined },
    );

    const replay = await harness.service.update('workflow-1', authoredGraph, AUTH, {
      idempotencyKey: 'operator-action:update-1',
      expectedVersionId: created.currentVersionId ?? undefined,
    });

    expect(replay.currentVersionId).toBe(authored.currentVersionId);
    expect(replay.currentVersion).toBe(authored.currentVersion);
    expect(replay.graph.description).toBe('Operator-authored revision');
    expect(harness.repository.activateVersion).toHaveBeenCalledTimes(3);
    expect(harness.versionRepository.create).toHaveBeenCalledTimes(3);
    expect(harness.auditLogService.recordDurableWithExecutor).toHaveBeenCalledTimes(3);
  });

  it('rejects a stale expected version before workflow, version, or audit writes', async () => {
    const created = await harness.service.create(GRAPH, AUTH);
    const latest = await harness.service.update(
      'workflow-1',
      { ...GRAPH, description: 'Human revision' },
      AUTH,
      { expectedVersionId: created.currentVersionId ?? undefined },
    );
    const writesBeforeConflict = {
      workflows: harness.repository.activateVersion.mock.calls.length,
      versions: harness.versionRepository.create.mock.calls.length,
      audits: harness.auditLogService.recordDurableWithExecutor.mock.calls.length,
    };

    await expect(
      harness.service.update(
        'workflow-1',
        { ...GRAPH, description: 'Stale Operator revision' },
        AUTH,
        {
          idempotencyKey: 'operator-action:stale-update',
          expectedVersionId: created.currentVersionId ?? undefined,
        },
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(harness.repository.activateVersion).toHaveBeenCalledTimes(
      writesBeforeConflict.workflows,
    );
    expect(harness.versionRepository.create).toHaveBeenCalledTimes(writesBeforeConflict.versions);
    expect(harness.auditLogService.recordDurableWithExecutor).toHaveBeenCalledTimes(
      writesBeforeConflict.audits,
    );
    expect(harness.getWorkflow()?.graph.description).toBe('Human revision');
    expect(harness.getVersions().at(-1)?.id).toBe(latest.currentVersionId ?? undefined);
  });
});
