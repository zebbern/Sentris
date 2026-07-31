import { describe, expect, it, vi } from 'bun:test';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { SELF_DECLARED_DEPS_METADATA } from '@nestjs/common/constants';
import type { AuthInfo } from '@modelcontextprotocol/server';

import { WorkflowRunRepository } from '../../workflows/repository/workflow-run.repository';
import { RunMcpScopeResolver } from '../run-mcp-scope-resolver.service';

const GRANT_ID = '97d45255-a20d-4f3b-82c7-0e464f57632b';

function makeAuthInfo(extra: Record<string, unknown>): AuthInfo {
  return {
    token: 'mcp_sk_test',
    clientId: 'agent-test',
    scopes: ['tools:list', 'tools:call'],
    extra,
  };
}

function makeResolver(run: { organizationId: string | null } | undefined) {
  const findByRunId = vi.fn(async () => run);
  const repository = { findByRunId } as unknown as WorkflowRunRepository;
  return { resolver: new RunMcpScopeResolver(repository), findByRunId };
}

describe('RunMcpScopeResolver', () => {
  it('publishes the concrete repository token for Nest dependency injection', () => {
    expect(Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, RunMcpScopeResolver)).toEqual([
      { index: 0, param: WorkflowRunRepository },
    ]);
  });

  it.each([
    ['local', null],
    ['organization-owned', 'org-1'],
  ])(
    'authorizes a matching %s run and returns a frozen context',
    async (_label, organizationId) => {
      const { resolver } = makeResolver({ organizationId });

      const context = await resolver.resolve(
        makeAuthInfo({
          runId: 'run-1',
          organizationId,
          capabilityGrantId: GRANT_ID,
          allowedNodeIds: ['node-b', 'node-a'],
        }),
      );

      expect(context).toEqual({
        kind: 'run',
        runId: 'run-1',
        organizationId,
        capabilityGrantId: GRANT_ID,
        allowedNodeIds: ['node-a', 'node-b'],
      });
      expect(Object.isFrozen(context)).toBe(true);
      expect(Object.isFrozen(context.allowedNodeIds)).toBe(true);
    },
  );

  it('rejects a token for a missing run before server creation', async () => {
    const { resolver } = makeResolver(undefined);

    await expect(
      resolver.resolve(
        makeAuthInfo({
          runId: 'missing-run',
          organizationId: 'org-1',
          capabilityGrantId: GRANT_ID,
          allowedNodeIds: [],
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([
    ['another organization', 'org-2'],
    ['an unscoped local token', null],
  ])('rejects a run owned by org-1 when the token belongs to %s', async (_label, tokenOrg) => {
    const { resolver } = makeResolver({ organizationId: 'org-1' });

    await expect(
      resolver.resolve(
        makeAuthInfo({
          runId: 'run-1',
          organizationId: tokenOrg,
          capabilityGrantId: GRANT_ID,
          allowedNodeIds: [],
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects malformed token context before querying the run repository', async () => {
    const repository = {
      findByRunId: vi.fn(async () => {
        throw new Error('repository must not be queried');
      }),
    } as unknown as WorkflowRunRepository;
    const resolver = new RunMcpScopeResolver(repository);

    await expect(
      resolver.resolve(
        makeAuthInfo({
          runId: 'run-1',
          organizationId: 'org-1',
          allowedNodeIds: [],
        }),
      ),
    ).rejects.toThrow('Invalid MCP run authentication context');
  });
});
